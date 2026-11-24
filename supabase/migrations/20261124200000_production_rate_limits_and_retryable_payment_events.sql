-- Shared rate-limit state and retryable webhook event lifecycle.
alter table public.payment_events
  add column if not exists processing_status text not null default 'processed',
  add column if not exists attempts integer not null default 1,
  add column if not exists locked_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text;
alter table public.payment_events drop constraint if exists payment_events_processing_status_check;
alter table public.payment_events add constraint payment_events_processing_status_check
  check (processing_status in ('processing', 'processed', 'failed', 'needs_review'));
alter table public.payment_events drop constraint if exists payment_events_attempts_check;
alter table public.payment_events add constraint payment_events_attempts_check check (attempts >= 1);
create index if not exists payment_events_retry_idx
  on public.payment_events (processing_status, locked_at)
  where processing_status in ('processing', 'failed');

create table if not exists public.api_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 1),
  expires_at timestamptz not null
);
create index if not exists api_rate_limits_expires_at_idx on public.api_rate_limits (expires_at);
alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from public, anon, authenticated, service_role;

create or replace function public.claim_payment_event(
  p_provider public.payment_provider, p_event_id text, p_event_type text, p_payload jsonb
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_id uuid; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_event_id is null or pg_catalog.length(pg_catalog.btrim(p_event_id)) = 0 then
    raise exception 'event_id_required';
  end if;
  insert into public.payment_events (
    provider,event_id,event_type,payload,processing_status,attempts,locked_at,processed_at,last_error
  ) values (
    p_provider,p_event_id,p_event_type,coalesce(p_payload,'{}'::jsonb),'processing',1,v_now,null,null
  )
  on conflict (provider,event_id) do update
    set event_type=excluded.event_type, payload=excluded.payload, processing_status='processing',
        attempts=payment_events.attempts+1, locked_at=v_now, processed_at=null, last_error=null
    where payment_events.processing_status in ('failed','received')
       or (payment_events.processing_status='processing' and
          (payment_events.locked_at is null or payment_events.locked_at < v_now - interval '5 minutes'))
  returning id into v_id;
  return v_id is not null;
end; $function$;

create or replace function public.finish_payment_event(
  p_provider public.payment_provider,p_event_id text,p_success boolean,p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_rows integer;
begin
  update public.payment_events
    set processing_status=case when p_success then 'processed' else 'failed' end,
        processed_at=case when p_success then pg_catalog.clock_timestamp() else null end,
        locked_at=null,
        last_error=case when p_success then null else pg_catalog.left(coalesce(p_error,'processing_failed'),500) end
    where provider=p_provider and event_id=p_event_id and processing_status='processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end; $function$;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,p_window_ms integer,p_max_requests integer
) returns table(allowed boolean,remaining integer,reset_at timestamptz)
language plpgsql security definer set search_path = '' as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_started_at timestamptz; v_count integer; v_reset_at timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_rate_limit_key'; end if;
  if p_window_ms is null or p_window_ms < 1 or p_window_ms > 86400000 then raise exception 'invalid_rate_limit_window'; end if;
  if p_max_requests is null or p_max_requests < 1 or p_max_requests > 100000 then raise exception 'invalid_rate_limit_maximum'; end if;
  insert into public.api_rate_limits as current_limit(key_hash,window_started_at,request_count,expires_at)
  values (p_key_hash,v_now,1,v_now+(p_window_ms*interval '1 millisecond')+interval '5 minutes')
  on conflict(key_hash) do update
    set window_started_at=case when current_limit.window_started_at+(p_window_ms*interval '1 millisecond')<=v_now then v_now else current_limit.window_started_at end,
        request_count=case when current_limit.window_started_at+(p_window_ms*interval '1 millisecond')<=v_now then 1 else current_limit.request_count+1 end,
        expires_at=case when current_limit.window_started_at+(p_window_ms*interval '1 millisecond')<=v_now then v_now+(p_window_ms*interval '1 millisecond')+interval '5 minutes' else current_limit.expires_at end
  returning current_limit.window_started_at,current_limit.request_count into v_started_at,v_count;
  v_reset_at:=v_started_at+(p_window_ms*interval '1 millisecond');
  if extract(epoch from v_now)::bigint % 60 = 0 then delete from public.api_rate_limits where expires_at<v_now; end if;
  return query select (v_count<=p_max_requests),greatest(p_max_requests-v_count,0),v_reset_at;
end; $function$;

revoke all on function public.claim_payment_event(public.payment_provider,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_payment_event(public.payment_provider,text,boolean,text) from public,anon,authenticated;
revoke all on function public.consume_api_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_payment_event(public.payment_provider,text,text,jsonb) to service_role;
grant execute on function public.finish_payment_event(public.payment_provider,text,boolean,text) to service_role;
grant execute on function public.consume_api_rate_limit(text,integer,integer) to service_role;
