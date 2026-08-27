-- =============================================================================
-- 002_products.sql — Store Products (align existing table + cover bucket + view)
-- =============================================================================
--
-- Run this once in the Supabase SQL editor (or psql). It is idempotent — safe to
-- re-run, and safe to run against the `products` table that already exists in
-- this project.
--
-- IMPORTANT: this migration ALTERS an existing table rather than creating one.
-- The table was made in the Supabase UI before these routes existed, so it is
-- missing three columns, has `price` as bigint, and carries an `image_url text[]`
-- whose name collides with the image_url the API derives from storage.
--
-- Mirrors the categories setup exactly:
--
--   categories                    products
--   --------------------------    --------------------------
--   bucket  category-images       bucket  product-images         (public)
--   object  <category id>-cover   object  <product id>-cover
--   view    categories_with_image view    products_with_image
--
-- The backend (backend/server.js, GET /api/products) prefers the
-- products_with_image view defined in section 11. Without it the API falls back
-- to the bare table, guesses `<id>-cover`, and runs an extra query per load to
-- resolve category names.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Grants
--
--    REQUIRED — without this the API fails with:
--      code 42501, "permission denied for table products"
--
--    PostgREST connects as anon / authenticated / service_role, and the service
--    role's RLS *bypass* does not include table privileges — those still have to
--    be granted explicitly.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Backend (service role) does all the writing.
grant select, insert, update, delete on public.products to service_role;

-- Storefront reads; still filtered by the RLS policy in section 9.
grant select on public.products to anon, authenticated;

-- Inserts need the identity sequence too.
do $$
declare
    v_seq text := pg_get_serial_sequence('public.products', 'id');
begin
    if v_seq is not null then
        execute format('grant usage, select on sequence %s to service_role', v_seq);
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Columns the admin form writes but the table does not have
--    Without these, every POST /api/products fails with PGRST204 / 42703.
-- -----------------------------------------------------------------------------
alter table public.products add column if not exists asset_folder text;
alter table public.products add column if not exists is_featured  boolean not null default false;

comment on column public.products.asset_folder is
    'Folder under assets/products/ holding this product''s gallery, e.g. "Frame Master" or "Cutting Machine/Rubber Support".';


-- -----------------------------------------------------------------------------
-- 3. price: bigint -> text
--
--    The storefront cards already render the unit inline ('₹ 1,200 / box',
--    '₹ 600 / roll'), and "On request" has to stay expressible, so price is
--    deliberately free text rather than a number.
--
--    TRADE-OFF: price can no longer be sorted or range-filtered server-side
--    without re-parsing the string. If a price filter is ever needed, split this
--    into a numeric amount + a unit label — far cheaper while the table is empty.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'products'
           and column_name = 'price' and data_type <> 'text'
    ) then
        alter table public.products alter column price type text using price::text;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. image_url -> gallery_paths
--
--    The API derives a scalar `image_url` from the storage bucket. With a column
--    of the same name, `select *` returns the array and withProductImageUrl()
--    then overwrites it — the array silently disappears from every response.
--    Renaming keeps the column (and its intent) for the phase-two gallery.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='products' and column_name='image_url')
       and not exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='products' and column_name='gallery_paths')
    then
        alter table public.products rename column image_url to gallery_paths;
    end if;
end $$;

-- Relax the optional columns.
--
-- The table was built in the Supabase UI with several columns marked NOT NULL
-- that the admin form legitimately leaves empty: `price` on an "on request"
-- product, `asset_folder` before a product's images are organised, and
-- `gallery_paths`, which the drawer never writes at all. Any one of them makes
-- every insert fail with 23502 — "null value in column … violates not-null
-- constraint" — which the dashboard shows as a blanket "Failed to save product".
--
-- Only `name`, `url_slug` and `is_active` stay NOT NULL; those are set in
-- section 6 because the API guarantees them.
do $$
declare
    v_col text;
begin
    foreach v_col in array array['price', 'gallery_paths', 'asset_folder', 'description', 'category_id']
    loop
        if exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name   = 'products'
               and column_name  = v_col
               and is_nullable  = 'NO'
        ) then
            execute format('alter table public.products alter column %I drop not null', v_col);
        end if;
    end loop;
end $$;

comment on column public.products.gallery_paths is
    'Reserved for the phase-two multi-image gallery. Not written by the current admin drawer.';


-- -----------------------------------------------------------------------------
-- 5. Make sure `id` auto-generates
--    A table created through the Supabase table editor without "Is Identity"
--    ticked will reject every insert coming from the API with a null-id error.
-- -----------------------------------------------------------------------------
do $$
declare
    v_is_identity text;
    v_default     text;
begin
    select is_identity, column_default
      into v_is_identity, v_default
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'products'
       and column_name  = 'id';

    if v_is_identity = 'NO' and v_default is null then
        alter table public.products alter column id add generated by default as identity;

        -- Start the sequence above whatever rows are already in the table.
        perform setval(
            pg_get_serial_sequence('public.products', 'id'),
            coalesce((select max(id) from public.products), 0) + 1,
            false
        );
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Backfill, then harden
-- -----------------------------------------------------------------------------

-- Any row with no slug gets one from its name, using the same rule the backend
-- uses (lowercase, non-alphanumerics -> '-').
update public.products
   set url_slug = regexp_replace(
                      regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '-', 'g'),
                      '^-+|-+$', '', 'g'
                  )
 where url_slug is null
    or btrim(url_slug) = '';

alter table public.products alter column name      set not null;
alter table public.products alter column url_slug  set not null;
alter table public.products alter column is_active set not null;
alter table public.products alter column is_active set default true;


-- -----------------------------------------------------------------------------
-- 7. Indexes
--
--    The unique index is load-bearing: the backend turns a 23505 violation into
--    a readable 409 ("that slug is already used"). Without the index, duplicate
--    slugs save silently and two products fight over one storefront URL.
-- -----------------------------------------------------------------------------
create unique index if not exists products_url_slug_key    on public.products (url_slug);
create index        if not exists products_is_active_idx   on public.products (is_active);
create index        if not exists products_category_id_idx on public.products (category_id);


-- -----------------------------------------------------------------------------
-- 8. Category link
--    Deleting a category orphans its products (category_id -> null) rather than
--    deleting them or blocking the delete. Matches categories.parent_id.
--    The backend turns a 23503 violation into a 400 if the category vanishes
--    mid-edit.
-- -----------------------------------------------------------------------------
do $$
declare
    v_conname text;
begin
    select conname into v_conname
      from pg_constraint
     where conrelid = 'public.products'::regclass
       and contype  = 'f'
       and conkey   = array[(select attnum from pg_attribute
                              where attrelid = 'public.products'::regclass
                                and attname  = 'category_id')];

    if v_conname is not null then
        execute format('alter table public.products drop constraint %I', v_conname);
    end if;

    alter table public.products
        add constraint products_category_id_fkey
        foreign key (category_id) references public.categories (id) on delete set null;
end $$;


-- -----------------------------------------------------------------------------
-- 9. updated_at maintenance
--    set_updated_at() already exists from 001_categories.sql; created here with
--    "or replace" so this file also works on a database where 001 never ran.
--
--    This timestamp is what busts the browser cache on a replaced cover image
--    (the API appends it as ?v=…), so a stale value serves the old picture.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
    before update on public.products
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 10. Row level security
--     The admin dashboard never touches this table directly — it goes through
--     the Express API with the service role key, which bypasses RLS. The policy
--     below only opens up what the public storefront is allowed to see.
--
--     Without it, anyone holding the anon key can read inactive products.
-- -----------------------------------------------------------------------------
alter table public.products enable row level security;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
    on public.products
    for select
    to anon, authenticated
    using (is_active = true);


-- -----------------------------------------------------------------------------
-- 11. Cover-image bucket
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Public read for the storefront + the admin table thumbnails.
drop policy if exists "Public can read product images" on storage.objects;
create policy "Public can read product images"
    on storage.objects
    for select
    to public
    using (bucket_id = 'product-images');

-- Writes are intentionally NOT opened to anon/authenticated: uploads only happen
-- through POST /api/products, which runs on the service role key.


-- -----------------------------------------------------------------------------
-- 12. THE READ QUERY — products joined to their cover image and their category
--
--       select * from public.products_with_image order by name asc;
--
--     `image_path` is null when no cover has been uploaded, so the API can send
--     image_url: null instead of a URL that 404s. `image_updated_at` changes
--     every time a cover is replaced and is appended to the URL as ?v=… so a
--     re-upload is visible immediately.
--
--     Full public URL, assembled by the backend:
--       <SUPABASE_URL>/storage/v1/object/public/product-images/<image_path>
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

-- Deliberately NOT granted to anon/authenticated. A plain view runs with its
-- owner's privileges, so the owner's RLS bypass would leak inactive products
-- (and storage metadata) to the public. Only the backend's service role reads it.
revoke all on public.products_with_image from anon, authenticated;
grant select on public.products_with_image to service_role;


-- -----------------------------------------------------------------------------
-- 13. Tell PostgREST to pick up the new columns and view immediately.
--     Without this the API can keep returning PGRST204 for a minute or two.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY — run this after the migration. Every column should read `true`/`ok`.
-- =============================================================================
--
-- select
--     (select count(*) = 1 from information_schema.columns
--       where table_schema='public' and table_name='products' and column_name='asset_folder')  as has_asset_folder,
--     (select count(*) = 1 from information_schema.columns
--       where table_schema='public' and table_name='products' and column_name='is_featured')   as has_is_featured,
--     (select count(*) = 1 from information_schema.columns
--       where table_schema='public' and table_name='products' and column_name='gallery_paths') as renamed_gallery,
--     (select count(*) = 0 from information_schema.columns
--       where table_schema='public' and table_name='products'
--         and column_name in ('price','gallery_paths','asset_folder','description','category_id')
--         and is_nullable = 'NO')                                                              as optionals_nullable,
--     (select data_type from information_schema.columns
--       where table_schema='public' and table_name='products' and column_name='price')         as price_type,
--     (select is_identity from information_schema.columns
--       where table_schema='public' and table_name='products' and column_name='id')            as id_identity,
--     (select count(*) = 1 from pg_indexes
--       where schemaname='public' and indexname='products_url_slug_key')                       as has_slug_unique,
--     (select count(*) = 1 from pg_views
--       where schemaname='public' and viewname='products_with_image')                          as has_view,
--     (select count(*) = 1 from storage.buckets where id='product-images')                     as has_bucket,
--     (select relrowsecurity from pg_class where oid='public.products'::regclass)              as rls_on,
--     (select confdeltype from pg_constraint where conname='products_category_id_fkey')        as fk_delete_rule;
--
-- Expected: true, true, true, true, 'text', 'YES', true, true, true, true, 'n'
--           (optionals_nullable must be true or inserts fail with 23502;
--            fk_delete_rule 'n' = SET NULL)
-- =============================================================================


-- =============================================================================
-- NEXT — after products have rows, derive categories.product_count
-- =============================================================================
-- 001_categories.sql ships product_count as a manually-edited column because no
-- products table existed. Now one does. Run this to make it real (it also drops
-- the manual field from the Categories drawer's responsibility):
--
--   alter table public.categories drop column product_count;
--
--   drop view if exists public.categories_with_image;
--   create view public.categories_with_image as
--   select c.id, c.name, c.url_slug, c.description,
--          (select count(*) from public.products p
--            where p.category_id = c.id and p.is_active = true) as product_count,
--          c.is_active, c.is_featured, c.parent_id, c.created_at, c.updated_at,
--          o.name       as image_path,
--          o.updated_at as image_updated_at
--     from public.categories c
--     left join storage.objects o
--            on o.bucket_id = 'category-images'
--           and o.name      = c.id::text || '-cover';
--
--   revoke all on public.categories_with_image from anon, authenticated;
--   grant select on public.categories_with_image to service_role;
--
-- The Categories API response shape does not change, so no frontend edits are
-- needed — but the PRODUCTS input in the Categories drawer becomes read-only in
-- effect (whatever is typed there is ignored once the value is derived).
-- =============================================================================
