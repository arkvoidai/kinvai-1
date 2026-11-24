-- Run the Shop: safely normalize collection/product metadata.
-- Products remain draft until the private downloads are uploaded and verified.
insert into public.collections(slug,name,tagline,story,accent,sort_order,is_active)
values ('run-the-shop','Run the Shop','Operating systems for independent sellers.','Practical operating tools for launching, pricing and running digital and physical product businesses.','apricot',1,true)
on conflict (slug) do update set name=excluded.name, tagline=excluded.tagline, story=excluded.story, accent=excluded.accent, sort_order=excluded.sort_order, is_active=excluded.is_active;
