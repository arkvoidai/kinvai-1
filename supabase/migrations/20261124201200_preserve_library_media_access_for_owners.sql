-- Keep private library artwork and collection metadata available to active owners
-- after a product or collection is unpublished. Public visitors still see published assets only.

drop policy if exists "media read" on public.product_media;
create policy "media read" on public.product_media
for select to anon, authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.products p
     where p.id = product_media.product_id
       and p.status = 'published'
  )
  or exists (
    select 1 from public.entitlements e
     where e.product_id = product_media.product_id
       and e.user_id = (select auth.uid())
       and e.revoked_at is null
  )
);

drop policy if exists "collections read" on public.collections;
create policy "collections read" on public.collections
for select to anon, authenticated
using (
  is_active
  or public.is_admin()
  or exists (
    select 1
      from public.products p
      join public.entitlements e on e.product_id = p.id
     where p.collection_id = collections.id
       and e.user_id = (select auth.uid())
       and e.revoked_at is null
  )
);

drop policy if exists "media public read published" on storage.objects;
create policy "media public read published" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'product-media'
  and (
    public.is_admin()
    or exists (
      select 1
        from public.product_media pm
        join public.products p on p.id = pm.product_id
       where p.status = 'published'
         and pm.storage_path =
           split_part(storage.objects.name, '/', 1) || '/' ||
           split_part(storage.objects.name, '/', 2) || '/' ||
           split_part(storage.objects.name, '/', 3)
    )
    or exists (
      select 1
        from public.collections c
       where c.is_active
         and c.image_path =
           split_part(storage.objects.name, '/', 1) || '/' ||
           split_part(storage.objects.name, '/', 2) || '/' ||
           split_part(storage.objects.name, '/', 3)
    )
    or exists (
      select 1
        from public.product_media pm
        join public.entitlements e on e.product_id = pm.product_id
       where e.user_id = (select auth.uid())
         and e.revoked_at is null
         and pm.storage_path =
           split_part(storage.objects.name, '/', 1) || '/' ||
           split_part(storage.objects.name, '/', 2) || '/' ||
           split_part(storage.objects.name, '/', 3)
    )
    or exists (
      select 1
        from public.collections c
        join public.products p on p.collection_id = c.id
        join public.entitlements e on e.product_id = p.id
       where e.user_id = (select auth.uid())
         and e.revoked_at is null
         and c.image_path =
           split_part(storage.objects.name, '/', 1) || '/' ||
           split_part(storage.objects.name, '/', 2) || '/' ||
           split_part(storage.objects.name, '/', 3)
    )
  )
);
