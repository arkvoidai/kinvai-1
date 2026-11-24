-- Store and apply provider refunds atomically and idempotently.
create table if not exists public.provider_refunds (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  provider_refund_id text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  constraint provider_refunds_provider_refund_id_key unique (provider, provider_refund_id)
);
create index if not exists provider_refunds_order_id_idx on public.provider_refunds(order_id);
alter table public.provider_refunds enable row level security;
revoke all on table public.provider_refunds from public, anon, authenticated, service_role;

create or replace function public.apply_order_refund(
  p_order_id uuid,p_provider public.payment_provider,p_provider_refund_id text,p_refund_cents integer
) returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_order public.orders%rowtype; v_refund_id uuid; v_existing_order_id uuid;
  v_existing_amount integer; v_total_refunded integer;
begin
  if p_provider_refund_id is null or pg_catalog.length(pg_catalog.btrim(p_provider_refund_id))=0 then raise exception 'refund_id_required'; end if;
  if p_refund_cents is null or p_refund_cents<=0 then raise exception 'invalid_refund_amount'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.provider is distinct from p_provider then raise exception 'provider_mismatch'; end if;

  insert into public.provider_refunds(provider,provider_refund_id,order_id,amount_cents)
  values(p_provider,p_provider_refund_id,p_order_id,p_refund_cents)
  on conflict(provider,provider_refund_id) do nothing
  returning id into v_refund_id;

  if v_refund_id is null then
    select order_id,amount_cents into v_existing_order_id,v_existing_amount
      from public.provider_refunds where provider=p_provider and provider_refund_id=p_provider_refund_id;
    if v_existing_order_id is distinct from p_order_id or v_existing_amount is distinct from p_refund_cents then raise exception 'refund_reference_conflict'; end if;
    return 'duplicate';
  end if;

  if v_order.status not in ('paid','partially_refunded','refunded') then raise exception 'order_not_refundable'; end if;
  select coalesce(sum(amount_cents),0)::integer into v_total_refunded
    from public.provider_refunds where order_id=p_order_id;
  if v_total_refunded>v_order.total_cents then raise exception 'refund_total_exceeds_order'; end if;

  if v_total_refunded=v_order.total_cents then
    update public.orders set status='refunded',refunded_cents=v_total_refunded where id=p_order_id;
    update public.entitlements set revoked_at=now() where order_id=p_order_id and revoked_at is null;
    return 'refunded';
  end if;
  update public.orders set status='partially_refunded',refunded_cents=v_total_refunded where id=p_order_id;
  return 'partially_refunded';
end; $function$;

revoke all on function public.apply_order_refund(uuid,public.payment_provider,text,integer) from public,anon,authenticated;
grant execute on function public.apply_order_refund(uuid,public.payment_provider,text,integer) to service_role;
