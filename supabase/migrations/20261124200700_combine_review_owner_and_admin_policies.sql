-- Merge customer and admin review writes into one policy per command.
-- Buyer-side conditions remain unchanged; admin access is OR'd explicitly.

drop policy if exists "reviews admin insert" on public.reviews;
drop policy if exists "reviews insert verified buyer" on public.reviews;
create policy "reviews insert verified buyer" on public.reviews
for insert to authenticated
with check (
  public.is_admin()
  or (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.entitlements e
       where e.user_id = (select auth.uid())
         and e.product_id = reviews.product_id
         and e.revoked_at is null
    )
  )
);

drop policy if exists "reviews admin update" on public.reviews;
drop policy if exists "reviews update own" on public.reviews;
create policy "reviews update own" on public.reviews
for update to authenticated
using (public.is_admin() or user_id = (select auth.uid()))
with check (public.is_admin() or user_id = (select auth.uid()));

drop policy if exists "reviews admin delete" on public.reviews;
drop policy if exists "reviews delete own" on public.reviews;
create policy "reviews delete own" on public.reviews
for delete to authenticated
using (public.is_admin() or user_id = (select auth.uid()));
