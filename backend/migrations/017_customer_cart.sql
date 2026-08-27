-- =============================================================================
-- 017_customer_cart.sql — the cart stops being a browser-wide global
-- =============================================================================
--
-- Run after 016. Idempotent — safe to re-run.
--
-- WHAT WAS WRONG
-- --------------
-- cart-module.js kept the whole cart in one localStorage key, `srk_cart`, with
-- nothing in it that said whose cart it was. That is one basket per *browser*,
-- not one per customer:
--
--   * a customer signs in, fills a cart, signs out — the lines are still on
--     screen for whoever uses that browser next;
--   * a second customer signs in on the same machine and inherits them;
--   * a visitor who never signs in leaves a cart behind on a shared computer
--     that outlives their visit, because localStorage has no session.
--
-- Nothing about that leaked anybody's *account* — the lines are product ids
-- and prices out of a public catalogue — but it is the wrong answer to "what
-- is in my cart" for every one of those people, and on a shared terminal it
-- reads as somebody else's shopping turning up in yours.
--
-- WHAT REPLACES IT
-- ----------------
-- A cart now has exactly one owner:
--
--   signed in   this table, keyed on user_id, read and written only through
--               GET / PUT /api/cart behind requireCustomer
--   guest       sessionStorage in the browser, which the tab throws away when
--               it closes — which is the whole of what a guest cart should
--               outlive, and localStorage never was
--
-- THE TABLE ALREADY EXISTED, AND HAD NEVER BEEN WRITTEN
-- -----------------------------------------------------
-- `cart_items` has been in the schema since before 010. 011 granted it SELECT
-- and deliberately stopped there — "no write grant, because nothing writes it
-- yet and an unused write grant is just an unguarded door". Something writes
-- it now, so the grant is issued here along with the shape the route needs.
--
-- Section 1 reconciles whatever shape the old table was left in. It will not
-- touch a table that holds rows: nothing has ever been able to insert one, so
-- a non-empty cart_items means somebody put data there by hand, and this
-- migration is not entitled to guess what it was for.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Reconcile the pre-existing table
--
--    Drops it only when all three are true: it exists, it is missing columns
--    this migration needs, and it is empty. Anything else either needs no
--    action or is somebody's data.
-- -----------------------------------------------------------------------------
do $$
declare
    v_missing text;
    v_rows    bigint;
begin
    if to_regclass('public.cart_items') is null then
        return;                       -- section 2 creates it
    end if;

    select string_agg(want.name, ', ')
      into v_missing
      from (values ('user_id'), ('product_id'), ('quantity'),
                   ('product_name'), ('product_price'),
                   ('category_name'), ('image_url')) as want(name)
     where not exists (
         select 1
           from information_schema.columns
          where table_schema = 'public'
            and table_name   = 'cart_items'
            and column_name  = want.name
     );

    if v_missing is null then
        return;                       -- already the shape below
    end if;

    execute 'select count(*) from public.cart_items' into v_rows;

    if v_rows > 0 then
        raise exception
            'public.cart_items is missing % and holds % row(s). Nothing has ever been able to insert into this table, so those rows were placed by hand. Move or delete them, then re-run this migration.',
            v_missing, v_rows;
    end if;

    raise notice 'cart_items existed but was missing % and was empty; recreating it.', v_missing;
    drop table public.cart_items;
end $$;


-- -----------------------------------------------------------------------------
-- 2. The table
--
--    WHY THE SNAPSHOT COLUMNS
--    cart-module.js has always stored the name, price, category and image
--    alongside the id, and re-resolved them against the live catalogue on
--    every paint: the live row wins while it exists, so an admin's price edit
--    shows up, but a product that is withdrawn or deleted does not make a line
--    silently vanish out from under somebody — it stays, marked unavailable,
--    and can still say what it was. Storing only (product_id, quantity) here
--    would have thrown that away the moment the cart moved server-side. Same
--    reasoning 009 gives for quote_request_items.
--
--    WHY product_price IS text AND NOT numeric
--    A deliberate difference from quote_request_items.product_price, which is
--    numeric. `products.price` is a text column and "On request" is a legal
--    value in it — 43 of 48 rows in the live catalogue today. numeric here
--    would turn every one of those snapshots into null on the way in, and the
--    drawer would show a blank where the shelf says "On request".
--
--    WHY THERE IS NO FOREIGN KEY ON product_id
--    Also 009's reasoning. A real FK would either block a product delete or
--    cascade into somebody's cart and rewrite it. The id is there for joining
--    while the product exists; it is not a constraint.
--
--    WHY THERE IS ONE ON user_id, AND WHY IT CASCADES
--    The opposite case: a cart with no owner is not a historical record of
--    anything, it is a row nothing can ever reach again. The cascade is also
--    what keeps DELETE /api/customers/:id (016) working — without it, deleting
--    a customer who has no orders but does have a cart fails on 23503, and
--    that route reports an unrecognised foreign key as "block them instead",
--    which would be advice about the wrong problem.
-- -----------------------------------------------------------------------------
create table if not exists public.cart_items (
    id            bigint      generated by default as identity primary key,
    user_id       bigint      not null references public.user_profiles (id) on delete cascade,
    product_id    bigint      not null,
    quantity      integer     not null default 1,
    product_name  text        not null default '',
    product_price text        not null default '',
    category_name text        not null default '',
    image_url     text        not null default '',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Guarded so the file stands alone on a database where the table already had
-- the right columns but not the constraints.
--
-- One product, one line. Two lines for the same product is not a thing a cart
-- can mean, and not a thing order_items can express either — priceCheckout()
-- collapses duplicates for exactly that reason. The unique index is also the
-- conflict target PUT /api/cart upserts on, so it is load-bearing rather than
-- hygiene.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'cart_items_user_product_unique') then
        alter table public.cart_items
            add constraint cart_items_user_product_unique unique (user_id, product_id);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'cart_items_quantity_check') then
        alter table public.cart_items
            add constraint cart_items_quantity_check check (quantity >= 1 and quantity <= 99);
    end if;
end $$;

comment on table public.cart_items is
    'One row per product in a signed-in customer cart. Written only by PUT /api/cart behind requireCustomer. A guest cart never reaches this table: it lives in the browser sessionStorage and dies with the tab.';

comment on column public.cart_items.product_price is
    'Snapshot of products.price as it read when the line was added. text, not numeric, because "On request" is a legal price in this catalogue.';


-- -----------------------------------------------------------------------------
-- 3. Indexes
--
--    None beyond the unique constraint. Every query this table serves is
--    "the rows for one user_id", and cart_items_user_product_unique is a
--    btree on (user_id, product_id) — a leading-column prefix match, so a
--    separate index on user_id alone would be a second copy of the same thing
--    for the planner to maintain and never choose.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 4. updated_at maintenance
--    public.set_updated_at() already exists from 001; recreated with
--    `or replace` so this file also stands alone on a fresh database.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
    before update on public.cart_items
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. Grants
--
--    The trap 001, 009, 011, 012, 014, 015 and 016 all document, once more:
--    the service role's RLS bypass is NOT a table privilege. 011 granted
--    SELECT here and nothing else, so without the line below PUT /api/cart
--    answers 42501 "permission denied for table cart_items" and the route's
--    catch block reports it as a flat 500 for a cart that is perfectly
--    writable.
--
--    DELETE is needed and is not a wider door than it looks: taking a line out
--    of your own cart is the ordinary case, and the route only ever deletes
--    rows matching the session's own user_id.
--
--    Nothing for anon or authenticated, ever. The browser does not talk to
--    PostgREST in this project — see "The browser never talks to Supabase" in
--    CLAUDE.md — and a cart is keyed by customer id, so a policy here would be
--    publishing one.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.cart_items to service_role;

-- Inserts need the identity sequence too.
do $$
declare
    v_seq text;
begin
    v_seq := pg_get_serial_sequence('public.cart_items', 'id');
    if v_seq is not null then
        execute format('grant usage, select on sequence %s to service_role', v_seq);
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Row level security — closed, no policies
--
--    Same access model as quote_requests, orders and user_profiles: RLS on
--    with no policies means nobody reaches this table but the service role,
--    which bypasses it. There is deliberately no commented-out opt-in block
--    below this one, unlike 009 — a live-updating cart is not a feature
--    anybody has asked for, and the only way to build one from the browser
--    would be to grant anon SELECT on a table keyed by customer id.
-- -----------------------------------------------------------------------------
alter table public.cart_items enable row level security;


-- -----------------------------------------------------------------------------
-- 7. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The shape.
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'cart_items'
--  order by ordinal_position;
-- Expected: id, user_id, product_id (bigint); quantity (integer);
--           product_name, product_price, category_name, image_url (text);
--           created_at, updated_at (timestamptz).
--
-- -- 2. One line per product per customer, and the conflict target PUT
-- --    /api/cart upserts on.
-- select conname, contype from pg_constraint
--  where conrelid = 'public.cart_items'::regclass order by conname;
-- Expected: cart_items_quantity_check (c), cart_items_user_product_unique (u),
--           the primary key, and the user_id foreign key.
--
-- -- 3. The grant that stops PUT /api/cart answering 42501.
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'service_role' and table_name = 'cart_items';
-- Expected: SELECT, INSERT, UPDATE, DELETE.
--
-- -- 4. Still unreachable with a browser key.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'cart_items' and grantee in ('anon', 'authenticated');
-- Expected: 0 rows.
--
-- -- 5. Deleting a customer takes their cart with it rather than failing on a
-- --    foreign key. A read-only check of the rule, not a deletion.
-- select confdeltype from pg_constraint
--  where conrelid = 'public.cart_items'::regclass and contype = 'f';
-- Expected: c  (cascade).
-- =============================================================================
