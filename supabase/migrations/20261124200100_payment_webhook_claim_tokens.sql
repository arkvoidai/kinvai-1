-- Add ownership tokens to webhook processing leases.
alter table public.payment_events add column if not exists lock_token uuid;
drop function if exists public.claim_payment_event(public.payment_provider,text,text,jsonb);
create function public.claim_payment_event(
 p_provider public.payment_provider,p_event_id text,p_event_type text,p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
 v_claim_token uuid:=pg_catalog.gen_random_uuid(); v_now timestamptz:=pg_catalog.clock_timestamp(); v_claimed_token uuid;
begin
 if p_event_id is null or pg_catalog.length(pg_catalog.btrim(p_event_id))=0 then raise exception 'event_id_required'; end if;
 insert into public.payment_events(provider,event_id,event_type,payload,processing_status,attempts,locked_at,lock_token,processed_at,last_error)
 values(p_provider,p_event_id,p_event_type,coalesce(p_payload,'{}'::jsonb),'processing',1,v_now,v_claim_token,null,null)
 on conflict(provider,event_id) do update
  set event_type=excluded.event_type,payload=excluded.payload,processing_status='processing',
      attempts=payment_events.attempts+1,locked_at=v_now,lock_token=v_claim_token,processed_at=null,last_error=null
  where payment_events.processing_status in ('failed','received')
     or (payment_events.processing_status='processing' and
        (payment_events.locked_at is null or payment_events.locked_at<v_now-interval '5 minutes'))
 returning lock_token into v_claimed_token;
 return v_claimed_token;
end; $function$;
drop function if exists public.finish_payment_event(public.payment_provider,text,boolean,text);
create function public.finish_payment_event(
 p_provider public.payment_provider,p_event_id text,p_lock_token uuid,p_success boolean,p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_rows integer;
begin
 update public.payment_events
  set processing_status=case when p_success then 'processed' else 'failed' end,
      processed_at=case when p_success then pg_catalog.clock_timestamp() else null end,
      locked_at=null,lock_token=null,
      last_error=case when p_success then null else pg_catalog.left(coalesce(p_error,'processing_failed'),500) end
  where provider=p_provider and event_id=p_event_id and processing_status='processing' and lock_token=p_lock_token;
 get diagnostics v_rows=row_count;
 return v_rows=1;
end; $function$;
revoke all on function public.claim_payment_event(public.payment_provider,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_payment_event(public.payment_provider,text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_payment_event(public.payment_provider,text,text,jsonb) to service_role;
grant execute on function public.finish_payment_event(public.payment_provider,text,uuid,boolean,text) to service_role;
