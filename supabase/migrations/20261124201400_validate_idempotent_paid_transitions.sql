-- Make already-paid transitions idempotent only for the exact provider payment already recorded.
-- A different payment ID or amount for an already-paid order must be rejected, never acknowledged.

create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_amount_cents integer,
  p_currency text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v public.orders%rowtype;
begin
  select * into v
    from public.orders
   where id = p_order_id
   for update;

  if not found then raise exception 'order_not_found'; end if;
  if v.provider is distinct from p_provider then raise exception 'provider_mismatch'; end if;

  if p_provider_payment_id is null
     or pg_catalog.length(pg_catalog.btrim(p_provider_payment_id)) not between 1 and 128 then
    raise exception 'payment_id_required';
  end if;
  if p_amount_cents is null
     or p_amount_cents <> v.total_cents
     or pg_catalog.upper(coalesce(p_currency, '')) <> v.currency then
    raise exception 'amount_or_currency_mismatch';
  end if;

  if v.status = 'paid' then
    if v.provider_payment_id is distinct from p_provider_payment_id then
      raise exception 'paid_order_payment_reference_conflict';
    end if;
    return 'already_paid';
  end if;

  if v.status not in ('created', 'pending', 'failed') then
    raise exception 'order_not_payable:%', v.status;
  end if;

  update public.orders
     set status = 'paid',
         provider_payment_id = p_provider_payment_id,
         paid_at = now(),
         failure_reason = null
   where id = v.id;

  insert into public.entitlements(user_id, product_id, order_id)
  select v.user_id, oi.product_id, v.id
    from public.order_items oi
   where oi.order_id = v.id
  on conflict (user_id, product_id)
  do update set revoked_at = null, order_id = excluded.order_id;

  return 'paid';
end;
$function$;

revoke all on function public.mark_order_paid(uuid,public.payment_provider,text,integer,text) from public,anon,authenticated;
grant execute on function public.mark_order_paid(uuid,public.payment_provider,text,integer,text) to service_role;
