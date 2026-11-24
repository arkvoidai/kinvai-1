-- Register a delivered file and optionally replace all active versions atomically.
-- The RPC is idempotent by client-generated file UUID to make retries safe after a lost response.
drop function if exists public.activate_product_file(uuid,uuid,boolean);

create or replace function public.register_product_file(
  p_product_id uuid,
  p_file_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_version text,
  p_checksum_sha256 text,
  p_deactivate_existing boolean default false
)
returns public.product_files
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.product_files%rowtype;
  v_file public.product_files%rowtype;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_file_id is null or p_product_id is null then raise exception 'product_and_file_required'; end if;
  if p_storage_path is null or p_storage_path !~ (
    '^products/' || p_product_id::text || '/[0-9a-fA-F-]{36}/[^/]{1,255}$'
  ) then raise exception 'invalid_product_file_storage_path'; end if;
  if p_file_name is null or pg_catalog.length(p_file_name) not between 1 and 255
     or pg_catalog.position('/' in p_file_name) > 0 then raise exception 'invalid_product_file_name'; end if;
  if p_size_bytes is null or p_size_bytes < 1 then raise exception 'invalid_product_file_size'; end if;
  if p_version is null or pg_catalog.length(pg_catalog.btrim(p_version)) not between 1 and 40 then raise exception 'invalid_product_file_version'; end if;
  if p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_product_file_checksum'; end if;

  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;

  select * into v_existing from public.product_files where id=p_file_id for update;
  if found then
    if v_existing.product_id is distinct from p_product_id
       or v_existing.storage_path is distinct from p_storage_path
       or v_existing.checksum_sha256 is distinct from p_checksum_sha256 then
      raise exception 'product_file_id_conflict';
    end if;
    return v_existing;
  end if;

  if not exists (
    select 1 from storage.objects
     where bucket_id='product-files' and name=p_storage_path
  ) then
    raise exception 'product_file_object_missing';
  end if;

  if coalesce(p_deactivate_existing,false) then
    update public.product_files
       set is_active=false
     where product_id=p_product_id and is_active=true;
  end if;

  insert into public.product_files(
    id,product_id,storage_path,file_name,mime_type,size_bytes,version,checksum_sha256,is_active
  )
  values(
    p_file_id,p_product_id,p_storage_path,p_file_name,p_mime_type,p_size_bytes,p_version,p_checksum_sha256,true
  )
  returning * into v_file;

  return v_file;
end;
$function$;

revoke all on function public.register_product_file(uuid,uuid,text,text,text,bigint,text,text,boolean) from public,anon;
grant execute on function public.register_product_file(uuid,uuid,text,text,text,bigint,text,text,boolean) to authenticated;
