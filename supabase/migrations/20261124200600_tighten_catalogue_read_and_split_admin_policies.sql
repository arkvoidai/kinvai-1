-- Narrow admin write policies to write operations and keep admin reads in dedicated read policies.
-- This removes overlapping permissive policies without changing legitimate admin access.

drop policy if exists "collections admin write" on public.collections;
create policy "collections admin insert" on public.collections for insert to authenticated with check (public.is_admin());
create policy "collections admin update" on public.collections for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "collections admin delete" on public.collections for delete to authenticated using (public.is_admin());

drop policy if exists "products admin write" on public.products;
create policy "products admin insert" on public.products for insert to authenticated with check (public.is_admin());
create policy "products admin update" on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products admin delete" on public.products for delete to authenticated using (public.is_admin());

drop policy if exists "media admin write" on public.product_media;
create policy "media admin insert" on public.product_media for insert to authenticated with check (public.is_admin());
create policy "media admin update" on public.product_media for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "media admin delete" on public.product_media for delete to authenticated using (public.is_admin());
drop policy if exists "media read" on public.product_media;
create policy "media read" on public.product_media for select to anon, authenticated
using (public.is_admin() or exists (
  select 1 from public.products p where p.id=product_media.product_id and p.status='published'
));

drop policy if exists "relations admin write" on public.product_relations;
create policy "relations admin insert" on public.product_relations for insert to authenticated with check (public.is_admin());
create policy "relations admin update" on public.product_relations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "relations admin delete" on public.product_relations for delete to authenticated using (public.is_admin());
drop policy if exists "relations read" on public.product_relations;
create policy "relations read" on public.product_relations for select to anon, authenticated
using (public.is_admin() or exists (
  select 1 from public.products p where p.id=product_relations.product_id and p.status='published'
));

drop policy if exists "reviews admin all" on public.reviews;
create policy "reviews admin insert" on public.reviews for insert to authenticated with check (public.is_admin());
create policy "reviews admin update" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reviews admin delete" on public.reviews for delete to authenticated using (public.is_admin());

drop policy if exists "settings admin write" on public.site_settings;
create policy "settings admin insert" on public.site_settings for insert to authenticated with check (public.is_admin());
create policy "settings admin update" on public.site_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "settings admin delete" on public.site_settings for delete to authenticated using (public.is_admin());
