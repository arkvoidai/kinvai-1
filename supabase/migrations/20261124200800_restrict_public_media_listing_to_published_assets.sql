-- Prevent public enumeration of media objects belonging to unpublished products.
-- Public object URLs remain compatible with the storefront's public product-media bucket.
drop policy if exists "media public read" on storage.objects;
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
  )
);
