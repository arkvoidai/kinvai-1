-- Make product media mutations atomic at the catalogue metadata layer.
-- Storage object cleanup remains an application follow-up after successful metadata mutation.

create or replace function public.set_product_cover(p_product_id uuid,p_media_id uuid)
returns text language plpgsql security invoker set search_path = '' as $function$
declare v_storage_path text;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  select storage_path into v_storage_path from public.product_media
   where id=p_media_id and product_id=p_product_id for update;
  if not found then raise exception 'product_media_not_found'; end if;
  update public.product_media set kind='gallery'
   where product_id=p_product_id and kind='cover' and id<>p_media_id;
  update public.product_media set kind='cover' where id=p_media_id and product_id=p_product_id;
  update public.products set cover_path=v_storage_path where id=p_product_id;
  return v_storage_path;
end; $function$;

create or replace function public.delete_product_media(p_product_id uuid,p_media_id uuid)
returns text language plpgsql security invoker set search_path = '' as $function$
declare v_storage_path text; v_was_cover boolean;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  select storage_path,kind='cover' into v_storage_path,v_was_cover
    from public.product_media where id=p_media_id and product_id=p_product_id for update;
  if not found then raise exception 'product_media_not_found'; end if;
  delete from public.product_media where id=p_media_id and product_id=p_product_id;
  if v_was_cover then update public.products set cover_path=null where id=p_product_id; end if;
  return v_storage_path;
end; $function$;

create or replace function public.swap_product_media_order(p_product_id uuid,p_media_id uuid,p_swap_media_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $function$
declare v_first_order integer; v_second_order integer;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_media_id=p_swap_media_id then raise exception 'media_rows_must_differ'; end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  select sort_order into v_first_order from public.product_media
   where id=p_media_id and product_id=p_product_id for update;
  if not found then raise exception 'product_media_not_found'; end if;
  select sort_order into v_second_order from public.product_media
   where id=p_swap_media_id and product_id=p_product_id for update;
  if not found then raise exception 'swap_product_media_not_found'; end if;
  update public.product_media set sort_order=v_second_order where id=p_media_id and product_id=p_product_id;
  update public.product_media set sort_order=v_first_order where id=p_swap_media_id and product_id=p_product_id;
  return true;
end; $function$;

revoke all on function public.set_product_cover(uuid,uuid) from public,anon;
revoke all on function public.delete_product_media(uuid,uuid) from public,anon;
revoke all on function public.swap_product_media_order(uuid,uuid,uuid) from public,anon;
grant execute on function public.set_product_cover(uuid,uuid) to authenticated;
grant execute on function public.delete_product_media(uuid,uuid) to authenticated;
grant execute on function public.swap_product_media_order(uuid,uuid,uuid) to authenticated;
