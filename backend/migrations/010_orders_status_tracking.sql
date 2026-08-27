-- =============================================================================
-- 010_orders_status_tracking.sql — order fulfillment status/tracking, and the
-- service_role grants the new admin Orders/Customers routes need to read any
-- of this schema at all
-- =============================================================================
--
-- Run after the `orders` / `order_items` / `order_shipping_address` /
-- `user_profiles` / `roles` / `shipping_addresses` / `payments` schema
-- already present in Supabase. Idempotent — safe to re-run.
--
-- `orders` as it stood had amount/tax/net and nothing describing where the
-- order actually is — no fulfillment status, no tracking number. The admin
-- dashboard's Orders tab needs both to be more than a read-only ledger. This
-- is deliberately separate from `payments.status`, which tracks whether money
-- moved, not whether the parcel did — an order can be Paid and still sit in
-- Processing for days.
--
-- Section 4 is not optional cleanup — GET /api/orders and GET /api/customers
-- (backend/server.js) fail with 500 / "permission denied for table ..."
-- (code 42501) without it. See that section's comment for why.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.orders add column if not exists status text not null default 'Processing';
alter table public.orders add column if not exists tracking text;

comment on column public.orders.status is
    'Fulfillment status shown and set from the admin Orders tab. One of Processing / Shipped / Delivered / Cancelled — see orders_status_check.';
comment on column public.orders.tracking is
    'Carrier tracking / AWB number. Free text (not numeric) so it can hold letters and dashes. Optional.';


-- -----------------------------------------------------------------------------
-- 2. Constrain status to the same four values the dashboard shows
-- -----------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'orders_status_check'
    ) then
        alter table public.orders
            add constraint orders_status_check
            check (status in ('Processing', 'Shipped', 'Delivered', 'Cancelled'));
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Index — the dashboard's status stat tiles and future filtering both
--    query on this column.
-- -----------------------------------------------------------------------------
create index if not exists orders_status_idx on public.orders (status);


-- -----------------------------------------------------------------------------
-- 4. Grants — REQUIRED, same trap section 5 of 001_categories.sql documents:
--    the service role's RLS bypass does not include table privileges, and a
--    table created straight from the Supabase table editor (as these were)
--    grants none by default. Without this every admin route touching these
--    tables fails with code 42501, "permission denied for table <name>".
--
--    service_role only — never anon/authenticated. These tables carry
--    customer PII (user_profiles, shipping_addresses) and financial detail
--    (orders, payments), same posture as quote_requests: only the backend
--    reaches them, nothing is exposed to the browser directly.
--
--    select only, except orders — the admin dashboard's PATCH updates
--    status/tracking on it. No insert/delete anywhere here: every one of
--    these rows is created by the storefront/checkout flow, not by admin.
-- -----------------------------------------------------------------------------
grant select, update on public.orders to service_role;
grant select on public.order_items to service_role;
grant select on public.order_shipping_address to service_role;
grant select on public.user_profiles to service_role;
grant select on public.roles to service_role;
grant select on public.shipping_addresses to service_role;
grant select on public.payments to service_role;


-- -----------------------------------------------------------------------------
-- 5. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select
--     (select count(*) = 1 from information_schema.columns
--       where table_name='orders' and column_name='status') as has_status,
--     (select count(*) = 1 from information_schema.columns
--       where table_name='orders' and column_name='tracking') as has_tracking,
--     (select count(*) = 1 from pg_constraint
--       where conname = 'orders_status_check') as has_check;
--
-- Expected: true, true, true
--
-- select status, count(*) from public.orders group by status;
-- Expected: every existing row already reads 'Processing' (the column default
-- backfills on add), and no row outside the four allowed values.
--
-- select table_name, privilege_type from information_schema.role_table_grants
-- where grantee = 'service_role'
--   and table_name in ('orders','order_items','order_shipping_address',
--                       'user_profiles','roles','shipping_addresses','payments');
-- Expected: SELECT on all seven, plus UPDATE on orders.
-- =============================================================================
