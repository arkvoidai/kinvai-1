-- Atomically activate a new downloadable file and optionally retire previous active versions.
create or replace function public.activate_product_file(
  p_product_id uuid,
  p_file_id uuid,
  p_deactivate_existing boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_file_id uuid;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;

  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;

  select id into v_file_id
    from public.product_files
   where id=p_file_id and product_id=p_product_id
   for update;
  if not found then raise exception 'product_file_not_found'; end if;

  if coalesce(p_deactivate_existing,false) then
    update public.product_files
       set is_active=false
     where product_id=p_product_id and id<>p_file_id and is_active=true;
  end if;

  update public.product_files set is_active=true
   where id=p_file_id and product_id=p_product_id;
  return true;
end;
$function$;

revoke all on function public.activate_product_file(uuid,uuid,boolean) from public,anon;
grant execute on function public.activate_product_file(uuid,uuid,boolean) to authenticated;
