-- =============================================================================
-- 016_customer_blocking.sql — suspending an account without destroying it
-- =============================================================================
--
-- Run after 015. Idempotent — safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- The Customers tab grew a row menu (View details / Block / Delete). Two of
-- those three need something the schema could not say.
--
-- "Delete" is the blunt one and it is deliberately NOT the common answer.
-- `orders.user_id` is NOT NULL, so removing a profile that has ever ordered
-- either fails on the foreign key or orphans an invoice — and an order is a
-- financial record, not a convenience. DELETE /api/customers/:id therefore
-- refuses a customer with orders and says so; blocking is what the admin
-- actually wants in that case, and it is reversible.
--
-- WHY A BOOLEAN AND NOT A STATUS ENUM
-- -----------------------------------
-- There are exactly two states an administrator can put an account into from
-- this screen, and a text status column invites a third that no code path
-- handles ('pending', 'flagged') — the same reasoning 015 gives for not
-- adding an `is_2fa_enabled` flag beside a secret whose presence already
-- carries the fact.
--
-- WHAT BLOCKED MEANS, IN CODE
-- ---------------------------
-- It is enforced on the server, not by hiding a button:
--
--   * POST /api/auth/login          refuses with 403 before starting a session
--   * requireCustomer               refuses with 403, so a session that was
--                                   already open stops working on the next
--                                   request rather than at cookie expiry
--   * GET  /api/auth/me             answers with a null customer, so the
--                                   storefront simply reads as signed out
--   * POST /api/checkout            will neither adopt nor create against a
--                                   blocked profile
--
-- ADMINS CANNOT BE BLOCKED
-- ------------------------
-- The routes refuse to set this on a row whose role is `admin`, and refuse to
-- act on the caller's own row. A dashboard button that can lock every
-- administrator out of the dashboard is a self-inflicted outage one misclick
-- away; making an admin row inert stays what it always was — a hand edit in
-- the Supabase table editor, the same place the role is granted.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The flag
--
--    NOT NULL with a default, unlike 015's nullable secret, because here
--    "unknown" is not a state worth representing: every existing row is, and
--    has always been, allowed to sign in.
-- -----------------------------------------------------------------------------
alter table public.user_profiles
    add column if not exists is_blocked boolean not null default false;

comment on column public.user_profiles.is_blocked is
    'True when an administrator has suspended this account. Enforced server-side in server.js (login, requireCustomer, /api/auth/me, checkout). Never set on an admin row — the routes refuse it.';


-- -----------------------------------------------------------------------------
-- 2. When, so the state can be explained rather than just observed
--
--    Cleared back to null on unblock, so the column never reads as "blocked
--    on 3 March" for an account that is currently fine.
-- -----------------------------------------------------------------------------
alter table public.user_profiles
    add column if not exists blocked_at timestamptz;

comment on column public.user_profiles.blocked_at is
    'When is_blocked was last set true. Null whenever is_blocked is false.';


-- -----------------------------------------------------------------------------
-- 3. Grants
--
--    The blocking columns need nothing, and that is worth saying rather than
--    leaving to be inferred: user_profiles already carries select / insert /
--    update to service_role from 011 and a new column inherits the
--    table-level grant; anon and authenticated have no privilege on this
--    table at all, so the flag is unreachable with a browser key even in
--    principle.
--
--    DELETE is the exception, and it is not optional. DELETE
--    /api/customers/:id ships in the same pass as the block flag, and 011
--    granted select / insert / update and stopped there — so without the
--    line below that route answers 42501 "permission denied for table
--    user_profiles", which its catch block reports as a flat 500 "Could not
--    delete that customer." The trap 001, 011, 012, 014 and 015 all
--    document, hit once more: the service role's RLS bypass is NOT a table
--    privilege, and the Supabase table editor grants none by default.
--
--    Deliberately NOT granted: delete on orders, order_items,
--    order_shipping_address or payments. A placed order is a financial
--    record, and the delete route refuses a customer who has one rather than
--    reaching for a privilege that would let it erase the evidence.
--    shipping_addresses already carries delete from 011, which is what lets
--    that route clear the customer's own saved address first.
-- -----------------------------------------------------------------------------
grant delete on public.user_profiles to service_role;



-- -----------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The columns exist, with the right nullability and default.
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'user_profiles'
--    and column_name in ('is_blocked', 'blocked_at');
-- Expected: is_blocked boolean / NO / false, blocked_at timestamptz / YES / null.
--
-- -- 2. Nobody is blocked yet.
-- select count(*) from public.user_profiles where is_blocked;
-- Expected: 0.
--
-- -- 3. No administrator is blocked, now or ever. This should stay 0 forever;
-- --    a non-zero answer means somebody wrote the column by hand.
-- select p.id, p.email from public.user_profiles p
--   join public.roles r on r.id = p.role_id
--  where lower(r.role_name) = 'admin' and p.is_blocked;
-- Expected: 0 rows.
--
-- -- 4. DELETE /api/customers/:id can actually delete. Without this grant the
-- --    route answers 500 and the dashboard shows "Could not delete that
-- --    customer" for a row that is perfectly deletable.
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'service_role' and table_name = 'user_profiles';
-- Expected: SELECT, INSERT, UPDATE and DELETE.
--
-- -- 5. Still unreachable with the browser's key.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'user_profiles' and grantee in ('anon', 'authenticated');
-- Expected: 0 rows.
-- =============================================================================
