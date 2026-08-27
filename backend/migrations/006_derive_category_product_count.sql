-- =============================================================================
-- 006_derive_category_product_count.sql — Products column stops being typed in
-- =============================================================================
--
-- Run after 002_products.sql. Idempotent — safe to re-run.
--
-- WHY
-- ---
-- `categories.product_count` was a plain integer the admin typed into the
-- category drawer, added in 001 back when there was no products table to count.
-- 002 created one, with a `category_id` on every product, so the number has had
-- a real source ever since — and a hand-typed copy of a number that the database
-- already knows drifts the moment anyone adds, moves or deletes a product.
--
-- 001 closed with a note describing exactly this migration. This is that note,
-- carried out.
--
-- WHAT CHANGES
-- ------------
--   - the manual column is dropped;
--   - `categories_with_image` grows a derived `product_count` in its place, so
--     the API response shape is unchanged and nothing downstream has to care.
--
-- The backend does not depend on this file having been run: server.js counts the
-- products table itself on every read (countProductsByCategory) and overwrites
-- whatever `product_count` the row carried. This migration is the cleanup that
-- removes the misleading column, not the thing that makes the count correct.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the view first — it selects the column, so the ALTER below would fail
--    on the dependency while it still exists.
-- -----------------------------------------------------------------------------
drop view if exists public.categories_with_image;


-- -----------------------------------------------------------------------------
-- 2. Drop the manual column
-- -----------------------------------------------------------------------------
alter table public.categories drop column if exists product_count;


-- -----------------------------------------------------------------------------
-- 3. Recreate the view with the count derived from the products table.
--
--    Guarded: on a database where 002 has not been run there is no products
--    table to count, so the view is rebuilt with a constant 0 rather than
--    failing and leaving the categories tab with no view at all.
-- -----------------------------------------------------------------------------
do $$
begin
    if to_regclass('public.products') is null then
        execute $view$
            create view public.categories_with_image as
            select
                c.*,
                0::bigint     as product_count,
                o.name        as image_path,
                o.updated_at  as image_updated_at
            from public.categories c
            left join storage.objects o
                   on o.bucket_id = 'category-images'
                  and o.name      = c.id::text || '-cover';
        $view$;
    else
        execute $view$
            create view public.categories_with_image as
            select
                c.*,
                (select count(*) from public.products p where p.category_id = c.id) as product_count,
                o.name        as image_path,
                o.updated_at  as image_updated_at
            from public.categories c
            left join storage.objects o
                   on o.bucket_id = 'category-images'
                  and o.name      = c.id::text || '-cover';
        $view$;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Same grants as 001 — a plain view runs with its owner's privileges, so the
--    owner's RLS bypass would leak inactive categories to the public. Only the
--    backend's service role reads it.
-- -----------------------------------------------------------------------------
revoke all on public.categories_with_image from anon, authenticated;
grant select on public.categories_with_image to service_role;
