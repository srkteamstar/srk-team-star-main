-- =============================================================================
-- 036_cart_write_serialization.sql — an atomic, revision-checked cart replace
-- =============================================================================
--
-- Run after 017. Idempotent — safe to re-run.
--
-- WHAT WAS WRONG (audit finding F06, HIGH)
-- -----------------------------------------
-- PUT /api/cart (cart.controller.js) replaced a customer's cart_items through
-- three separate, unlocked statements — read existing product ids, upsert the
-- new set, delete what is gone — with no transaction and no check that the row
-- it was about to overwrite was still the row it had last read. Two
-- overlapping PUTs (a debounced browser write racing an immediate one, or two
-- tabs/devices) could interleave so that the OLDER request's upsert landed
-- LAST, silently reverting a newer quantity. The client-side half of this fix
-- (public/js/modules/cart/cart-module.js) now serializes its own writes onto
-- one ordered queue, but that only protects a single tab against itself — two
-- genuinely different browsers can still race at the server, which is what
-- this migration closes.
--
-- WHAT REPLACES IT
-- -----------------
-- One new table holding a per-customer revision counter, and one RPC —
-- replace_customer_cart() — that locks that counter, optionally checks it
-- against a revision the caller last read, and only then performs the same
-- upsert-before-delete cart.controller.js already did, inside one Postgres
-- function so the whole thing commits or rolls back together. A caller that
-- supplies a revision which no longer matches gets a conflict answer instead
-- of a silent overwrite; cart.controller.js turns that into 409.
--
-- p_expected_revision is NULLABLE, and that is deliberate: a browser that has
-- never read a revision yet (its very first write) has nothing to compare
-- against, and refusing that write would break every cart's first save. A
-- null expected revision skips the check and simply proceeds — the same
-- "last write wins" behaviour this route already had, degrading to it only
-- for a caller that could not have known better.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The revision counter — one row per customer, created on first use.
-- -----------------------------------------------------------------------------
create table if not exists public.cart_revisions (
    user_id    bigint      primary key references public.user_profiles (id) on delete cascade,
    revision   bigint      not null default 0,
    updated_at timestamptz not null default now()
);

comment on table public.cart_revisions is
    'One row per customer holding the current cart revision. Locked and incremented by replace_customer_cart() so two concurrent PUT /api/cart calls for the same customer cannot interleave into a lost update.';

grant usage on schema public to service_role;
grant select, insert, update on public.cart_revisions to service_role;

do $$
declare
    v_seq text;
begin
    v_seq := pg_get_serial_sequence('public.cart_revisions', 'user_id');
    if v_seq is not null then
        execute format('grant usage, select on sequence %s to service_role', v_seq);
    end if;
end $$;

alter table public.cart_revisions enable row level security;


-- -----------------------------------------------------------------------------
-- 2. The atomic replace, revision-checked.
--
--    Mirrors cart.controller.js's existing upsert-before-delete ordering
--    exactly (a partial failure must leave an extra line, never a missing
--    one) — this function does not change that reasoning, it makes the whole
--    sequence run under one row lock instead of three unlocked round trips.
-- -----------------------------------------------------------------------------
create or replace function public.replace_customer_cart(
    p_user_id bigint,
    p_expected_revision bigint,
    p_items jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_revision bigint;
    v_keep_ids bigint[];
begin
    if p_user_id is null then
        raise exception 'a customer id is required';
    end if;
    if jsonb_typeof(p_items) <> 'array' then
        raise exception 'cart items must be an array';
    end if;

    -- Row-locked for the life of this transaction, so a second call for the
    -- SAME customer blocks behind this one instead of interleaving with it —
    -- this is the guarantee three separate PostgREST calls could not offer.
    insert into public.cart_revisions (user_id, revision)
        values (p_user_id, 0)
        on conflict (user_id) do nothing;

    select revision into v_revision
      from public.cart_revisions
     where user_id = p_user_id
       for update;

    if p_expected_revision is not null and v_revision is distinct from p_expected_revision then
        return jsonb_build_object('conflict', true, 'revision', v_revision);
    end if;

    select array_agg((item->>'product_id')::bigint)
      into v_keep_ids
      from jsonb_array_elements(p_items) as item;

    if v_keep_ids is null then
        v_keep_ids := array[]::bigint[];
    end if;

    -- Upsert first, delete second — same order and the same reason
    -- cart.controller.js documents: a failure between the two must leave a
    -- line the customer removed (harmless; the next write clears it), never
    -- delete a line they still have.
    insert into public.cart_items (
        user_id, product_id, quantity, product_name, product_price, category_name, image_url
    )
    select p_user_id, (item->>'product_id')::bigint, (item->>'quantity')::integer,
           coalesce(item->>'product_name', ''), coalesce(item->>'product_price', ''),
           coalesce(item->>'category_name', ''), coalesce(item->>'image_url', '')
      from jsonb_array_elements(p_items) as item
    on conflict (user_id, product_id) do update set
        quantity = excluded.quantity,
        product_name = excluded.product_name,
        product_price = excluded.product_price,
        category_name = excluded.category_name,
        image_url = excluded.image_url;

    delete from public.cart_items
     where user_id = p_user_id
       and not (product_id = any(v_keep_ids));

    update public.cart_revisions
       set revision = v_revision + 1, updated_at = now()
     where user_id = p_user_id
    returning revision into v_revision;

    return jsonb_build_object(
        'conflict', false,
        'revision', v_revision,
        'items', (
            select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb)
              from public.cart_items row
             where row.user_id = p_user_id
        )
    );
end;
$$;

revoke all on function public.replace_customer_cart(bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.replace_customer_cart(bigint,bigint,jsonb) to service_role;

comment on function public.replace_customer_cart(bigint,bigint,jsonb) is
    'Server-only atomic cart replace. Locks the caller''s revision row for the transaction, rejects a stale p_expected_revision with conflict:true instead of overwriting, and otherwise performs the same upsert-before-delete replacement PUT /api/cart always has.';

notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The table.
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'cart_revisions'
--  order by ordinal_position;
-- Expected: user_id (bigint), revision (bigint), updated_at (timestamptz).
--
-- -- 2. The function is present and locked down.
-- select proname from pg_proc where proname = 'replace_customer_cart';
-- select grantee, privilege_type from information_schema.role_routine_grants
--  where routine_name = 'replace_customer_cart';
-- Expected: only service_role, EXECUTE.
--
-- -- 3. A stale revision is refused rather than applied.
-- select public.replace_customer_cart(200, 0, '[{"product_id":1,"quantity":1}]'::jsonb);
-- -- returns conflict:false, revision:1
-- select public.replace_customer_cart(200, 0, '[{"product_id":1,"quantity":9}]'::jsonb);
-- -- called again with the now-stale revision 0: returns conflict:true, revision:1,
-- -- and cart_items is unchanged.
-- =============================================================================
