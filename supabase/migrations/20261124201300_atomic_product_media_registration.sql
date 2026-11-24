-- Atomically register responsive product artwork and optionally promote it to cover.
-- Retries with the same media UUID return the existing row instead of duplicating metadata.

create or replace function public.register_product_media(
  p_product_id uuid,
  p_media_id uuid,
  p_storage_path text,
  p_alt text,
  p_width integer,
  p_height integer,
  p_source text,
  p_set_as_cover boolean default false
)
returns public.product_media
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.product_media%rowtype;
  v_media public.product_media%rowtype;
  v_variant_count integer;
  v_sort_order integer;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_product_id is null or p_media_id is null then raise exception 'product_and_media_required'; end if;
  if p_storage_path is null or p_storage_path !~ ('^products/' || p_product_id::text || '/[0-9a-fA-F-]{36}$') then
    raise exception 'invalid_product_media_storage_path';
  end if;
  if p_alt is null or pg_catalog.length(pg_catalog.btrim(p_alt)) not between 1 and 500 then
    raise exception 'invalid_product_media_alt';
  end if;
  if p_width is null or p_width < 1 or p_height is null or p_height < 1 then
    raise exception 'invalid_product_media_dimensions';
  end if;
  if p_source not in ('upload','gemini') then raise exception 'invalid_product_media_source'; end if;

  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;

  select count(*)::integer into v_variant_count
    from storage.objects
   where bucket_id='product-media'
     and name in (
       p_storage_path || '/480.webp',
       p_storage_path || '/960.webp',
       p_storage_path || '/1600.webp'
     );
  if v_variant_count <> 3 then raise exception 'product_media_variants_missing'; end if;

  select * into v_existing
    from public.product_media
   where id=p_media_id
   for update;
  if found then
    if v_existing.product_id is distinct from p_product_id
       or v_existing.storage_path is distinct from p_storage_path
       or v_existing.alt is distinct from p_alt
       or v_existing.width is distinct from p_width
       or v_existing.height is distinct from p_height
       or v_existing.source is distinct from p_source then
      raise exception 'product_media_id_conflict';
    end if;
    if coalesce(p_set_as_cover,false) then
      perform public.set_product_cover(p_product_id,p_media_id);
      select * into v_existing from public.product_media where id=p_media_id;
    end if;
    return v_existing;
  end if;

  select coalesce(max(sort_order),-1)+1 into v_sort_order
    from public.product_media
   where product_id=p_product_id;

  insert into public.product_media(
    id,product_id,storage_path,kind,alt,width,height,sort_order,source
  )
  values(
    p_media_id,p_product_id,p_storage_path,'gallery',p_alt,p_width,p_height,v_sort_order,p_source
  )
  returning * into v_media;

  if coalesce(p_set_as_cover,false) then
    perform public.set_product_cover(p_product_id,p_media_id);
    select * into v_media from public.product_media where id=p_media_id;
  end if;

  return v_media;
end;
$function$;

revoke all on function public.register_product_media(uuid,uuid,text,text,integer,integer,text,boolean) from public,anon;
grant execute on function public.register_product_media(uuid,uuid,text,text,integer,integer,text,boolean) to authenticated;
