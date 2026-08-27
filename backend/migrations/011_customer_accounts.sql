-- =============================================================================
-- 011_customer_accounts.sql — make user_profiles / shipping_addresses able to
-- hold a real storefront account, and let the backend write them
-- =============================================================================
--
-- Run after 010. Idempotent — safe to re-run.
--
-- Context: the storefront's account overlay (profile-icon-loader.js) and its
-- session module were sample data in localStorage. This is the schema half of
-- pointing them at the real tables. Every customer table was empty when this
-- was written, so the type changes below rewrite nothing.
--
-- AUTH POLICY
-- -----------
-- Customer access is identifier-only. Migration 022 briefly introduced a
-- password column and migration 023 removed it; migration 024 restores only
-- the separate administrator TOTP columns.
--
-- ADMIN IS A ROLE ON THIS TABLE NOW
-- ---------------------------------
-- The current admin dashboard has a separate identifier + TOTP gate.
-- Granting admin is deliberately a hand edit in the Supabase table editor
-- (set role_id = 1) — there is no route, no UI and no self-service path that
-- can raise a role, which is the one thing keeping that door shut.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. user_profiles.phone_number: int8 -> text
--
--    Same bug backend/server.js already flags on enquiries.enquirer_phone_number
--    and 009_quote_requests.sql deliberately did not repeat: an integer drops
--    the leading zero from 08901503544, cannot hold the '+' of +91, and cannot
--    hold the spaces people actually type. It is an identifier, not a quantity
--    — nothing ever sums or orders by it.
--
--    Load-bearing now rather than cosmetic: phone is one of the two things you
--    can sign in with, so a number that cannot round-trip is an account that
--    cannot be reached.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'user_profiles'
          and column_name = 'phone_number' and data_type <> 'text'
    ) then
        alter table public.user_profiles
            alter column phone_number type text using phone_number::text;
    end if;
end $$;

comment on column public.user_profiles.phone_number is
    'As the customer typed it, for display and for calling them back. Never numeric — see migration 011.';


-- -----------------------------------------------------------------------------
-- 2. phone_normalized — what sign-in actually matches on
--
--    phone_number keeps the human formatting; this holds digits only, so
--    "+91 89015 03544", "089015 03544" and "8901503544" all resolve to the
--    same account. The rule lives in normalizePhone() in backend/server.js and
--    is applied on write — there is no trigger here, so nothing can normalise
--    a row by a rule the application does not share.
--
--    Unique, because it is a login identifier: two accounts answering to one
--    number means sign-in has no single answer. Nullable so the index cannot
--    block a legacy row, though phone_number is NOT NULL so the backend always
--    fills it.
-- -----------------------------------------------------------------------------
alter table public.user_profiles add column if not exists phone_normalized text;

create unique index if not exists user_profiles_phone_normalized_key
    on public.user_profiles (phone_normalized)
    where phone_normalized is not null;

comment on column public.user_profiles.phone_normalized is
    'Digits-only form of phone_number, written by the backend. What POST /api/auth/login matches a typed phone against.';


-- -----------------------------------------------------------------------------
-- 3. company — the account overlay has always collected a "Business Name"
--    and there was nowhere to put it. This is a B2B catalogue; the business
--    is frequently the more useful label of the two.
-- -----------------------------------------------------------------------------
alter table public.user_profiles add column if not exists company text;


-- -----------------------------------------------------------------------------
-- 4. Email is the other sign-in identifier, so it must be unique — and
--    case-insensitively, since nobody types their address the same way twice.
--    Lowered in the index rather than on the column, so the address is still
--    stored as the customer wrote it.
-- -----------------------------------------------------------------------------
create unique index if not exists user_profiles_email_lower_key
    on public.user_profiles (lower(email));


-- -----------------------------------------------------------------------------
-- 5. Defaults. A storefront signup is a customer (roles.id = 2).
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from public.roles where id = 2) then
        alter table public.user_profiles alter column role_id set default 2;
    end if;
end $$;

alter table public.user_profiles alter column created_at set default now();
alter table public.user_profiles alter column updated_at set default now();


-- -----------------------------------------------------------------------------
-- 6. shipping_addresses.zip_code: numeric -> text
--
--    Same reasoning as phone_number. A PIN/ZIP is a label: leading zeros are
--    real (Indian PINs do not start with 0, but plenty of countries' do), and
--    numeric would also happily accept 360002.5.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'shipping_addresses'
          and column_name = 'zip_code' and data_type <> 'text'
    ) then
        alter table public.shipping_addresses
            alter column zip_code type text using zip_code::text;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 7. shipping_addresses.updatde_at -> updated_at
--
--    A typo in the original column name. Renamed rather than left alone
--    because every other table here spells it updated_at, and code that reads
--    or writes the row by name will keep quietly missing it otherwise.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'shipping_addresses'
          and column_name = 'updatde_at'
    ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'shipping_addresses'
          and column_name = 'updated_at'
    ) then
        alter table public.shipping_addresses rename column updatde_at to updated_at;
    end if;
end $$;

alter table public.shipping_addresses alter column created_at set default now();


-- -----------------------------------------------------------------------------
-- 8. ONE address per customer, enforced here and not just in the UI.
--
--    The account overlay collects a single address in step 02 of signup and
--    PATCH /api/auth/me upserts it. Without this index a bug in that upsert
--    leaves a customer with two addresses and no rule saying which one a
--    parcel goes to — the kind of thing that is invisible until something
--    ships to the wrong place.
--
--    order_shipping_address is untouched by this: that is the per-order
--    snapshot, and there is deliberately one of those per order, frozen at
--    the moment it was placed. Editing your address must not silently rewrite
--    where past orders went — same reasoning as quote_request_items keeping
--    its own copy of the product name and price.
--
--    Should multiple saved addresses ever be wanted, this index is the one
--    thing to drop, plus a chosen-address column on orders.
-- -----------------------------------------------------------------------------
create unique index if not exists shipping_addresses_one_per_user_key
    on public.shipping_addresses (user_id);


-- -----------------------------------------------------------------------------
-- 9. Grants — same trap section 4 of 010 and section 5 of 001 document: the
--    service role's RLS bypass is not a table privilege, and a table made in
--    the Supabase table editor grants none by default.
--
--    010 granted SELECT on user_profiles and shipping_addresses, which was all
--    the read-only admin Customers tab needed. The storefront now creates and
--    edits these rows, so it needs more — but only on the two tables a
--    customer owns.
--
--    cart_items was missed by 010 entirely and answers 42501 to the backend
--    today. Granted read here so it stops being a landmine; no write grant,
--    because nothing writes it yet (cart-module.js is still localStorage) and
--    an unused write grant is just an unguarded door.
--
--    service_role only, never anon/authenticated: these rows are customer PII
--    and the browser never talks to PostgREST directly for them.
-- -----------------------------------------------------------------------------
grant select, insert, update on public.user_profiles to service_role;
grant select, insert, update, delete on public.shipping_addresses to service_role;
grant select on public.cart_items to service_role;

-- Guarded: a column declared `generated as identity` owns its sequence and
-- needs no separate grant, and the sequence may not exist under this name at
-- all. An unguarded grant on a missing sequence aborts the whole migration.
do $$
declare
    seq text;
begin
    foreach seq in array array['user_profiles_id_seq', 'shipping_addresses_id_seq']
    loop
        if exists (
            select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'S' and n.nspname = 'public' and c.relname = seq
        ) then
            execute format('grant usage, select on sequence public.%I to service_role', seq);
        end if;
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 10. RLS stays ON with no policies — closed to everyone but the service role,
--     the posture 009 chose for quote_requests and for the same reason. These
--     tables hold names, emails, phone numbers and street addresses; the anon
--     key is readable by anyone who opens devtools, so a policy here would
--     publish the customer list. Do not add one to make realtime work.
-- -----------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.shipping_addresses enable row level security;


-- -----------------------------------------------------------------------------
-- 11. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='user_profiles' order by ordinal_position;
-- Expected: phone_number text, phone_normalized text, company text present.
--
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='shipping_addresses' order by ordinal_position;
-- Expected: zip_code text, and updated_at (not updatde_at).
--
-- select indexname from pg_indexes where schemaname='public'
--   and tablename in ('user_profiles','shipping_addresses');
-- Expected to include: user_profiles_email_lower_key,
--   user_profiles_phone_normalized_key, shipping_addresses_one_per_user_key.
--
-- select table_name, privilege_type from information_schema.role_table_grants
--  where grantee='service_role'
--    and table_name in ('user_profiles','shipping_addresses','cart_items');
-- Expected: SELECT/INSERT/UPDATE on user_profiles, those plus DELETE on
--   shipping_addresses, SELECT on cart_items.
--
-- To make yourself an admin once you have signed up on the storefront:
--   update public.user_profiles set role_id = 1 where lower(email) = lower('you@example.com');
-- =============================================================================
