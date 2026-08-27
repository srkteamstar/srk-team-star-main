-- =============================================================================
-- 003_product_flags.sql — Best Seller / New Arrival flags on products
-- =============================================================================
--
-- Run after 002_products.sql. Idempotent — safe to re-run.
--
-- Adds the two storefront placement flags that sit alongside is_featured in the
-- admin drawer. All three are independent booleans, not a single "badge" enum:
-- a product can legitimately be featured AND a best seller AND a new arrival,
-- and the storefront sections that read them (featured-section-loader.js,
-- best-seller-section-loader.js, new-arrivals-section-loader.js) are separate
-- carousels that each need their own filter.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.products add column if not exists is_best_seller boolean not null default false;
alter table public.products add column if not exists is_new_arrival boolean not null default false;

comment on column public.products.is_best_seller is
    'Shows this product in the storefront Best Sellers carousel.';
comment on column public.products.is_new_arrival is
    'Shows this product in the storefront New Arrivals carousel.';


-- -----------------------------------------------------------------------------
-- 2. Partial indexes
--    Each storefront carousel queries one flag and only ever wants the true
--    rows, so a partial index stays tiny no matter how large the catalogue gets.
-- -----------------------------------------------------------------------------
create index if not exists products_is_featured_idx
    on public.products (is_featured) where is_featured;
create index if not exists products_is_best_seller_idx
    on public.products (is_best_seller) where is_best_seller;
create index if not exists products_is_new_arrival_idx
    on public.products (is_new_arrival) where is_new_arrival;


-- -----------------------------------------------------------------------------
-- 3. Rebuild the read view so the API sees the new columns
--
--    NOTE: 004_product_images.sql replaces this view again to add the grouped
--    image payload. This definition is here so 003 is correct on its own if you
--    stop after it.
-- -----------------------------------------------------------------------------
drop view if exists public.products_with_image;

create view public.products_with_image as
select
    p.id,
    p.name,
    p.url_slug,
    p.description,
    p.price,
    p.category_id,
    p.asset_folder,
    p.is_active,
    p.is_featured,
    p.is_best_seller,
    p.is_new_arrival,
    p.created_at,
    p.updated_at,
    c.name        as category_name,
    o.name        as image_path,
    o.updated_at  as image_updated_at
from public.products p
left join public.categories c
       on c.id = p.category_id
left join storage.objects o
       on o.bucket_id = 'product-images'
      and o.name      = p.id::text || '-cover';

revoke all on public.products_with_image from anon, authenticated;
grant select on public.products_with_image to service_role;


-- -----------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select
--     (select count(*) = 1 from information_schema.columns
--       where table_name='products' and column_name='is_best_seller') as has_best_seller,
--     (select count(*) = 1 from information_schema.columns
--       where table_name='products' and column_name='is_new_arrival') as has_new_arrival;
--
-- Expected: true, true
-- =============================================================================
