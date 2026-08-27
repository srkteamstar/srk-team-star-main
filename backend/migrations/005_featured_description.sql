-- =============================================================================
-- 005_featured_description.sql — Dedicated copy for the storefront featured slide
-- =============================================================================
--
-- Run after 004_product_images.sql. Idempotent — safe to re-run.
--
-- WHY A SEPARATE COLUMN
-- ---------------------
-- The featured slideshow on the store home page used to borrow
-- `products.description`. Those two pieces of copy have different jobs:
--
--   description           — the full catalogue blurb. Long, specification-led,
--                           read by someone already looking at the product.
--   featured_description  — one or two lines of hero copy. Short, persuasive,
--                           read by someone who has not decided to look yet.
--
-- Sharing one field forced a compromise that suited neither, and truncating the
-- catalogue text mid-sentence in the hero looked broken. They are now separate,
-- and the hero reads only from featured_description.
--
-- Left blank, the hero falls back to a neutral house line — deliberately NOT to
-- `description`, since the whole point is that the two are unlinked.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Column
-- -----------------------------------------------------------------------------
alter table public.products add column if not exists featured_description text;

comment on column public.products.featured_description is
    'Hero copy for the storefront featured slideshow. Independent of description; blank falls back to a house line, never to description.';


-- -----------------------------------------------------------------------------
-- 2. Rebuild the read view so the API can see it
--    Same definition as 004 with featured_description added.
-- -----------------------------------------------------------------------------
drop view if exists public.products_with_image;

create view public.products_with_image as
select
    p.id,
    p.name,
    p.url_slug,
    p.description,
    p.featured_description,
    p.price,
    p.category_id,
    p.asset_folder,
    p.is_active,
    p.is_featured,
    p.is_best_seller,
    p.is_new_arrival,
    p.created_at,
    p.updated_at,
    c.name as category_name,
    coalesce(img.images, '[]'::json) as images
from public.products p
left join public.categories c
       on c.id = p.category_id
left join lateral (
    select json_agg(
               json_build_object(
                   'slot',       pi.slot,
                   'is_main',    pi.is_main,
                   'path',       p.id::text || '/' || pi.slot::text,
                   'updated_at', coalesce(o.updated_at, pi.updated_at)
               )
               order by pi.slot
           ) as images
      from public.product_images pi
      left join storage.objects o
             on o.bucket_id = 'product-images'
            and o.name      = p.id::text || '/' || pi.slot::text
     where pi.product_id = p.id
) img on true;

-- Deliberately NOT granted to anon/authenticated. A plain view runs with its
-- owner's privileges, so the owner's RLS bypass would leak inactive products.
revoke all on public.products_with_image from anon, authenticated;
grant select on public.products_with_image to service_role;


-- -----------------------------------------------------------------------------
-- 3. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select
--     (select count(*) = 1 from information_schema.columns
--       where table_name='products' and column_name='featured_description') as has_column,
--     (select count(*) = 1 from information_schema.columns
--       where table_name='products_with_image'
--         and column_name='featured_description')                          as in_view;
--
-- Expected: true, true
-- =============================================================================
