-- =============================================================================
-- 041_order_history_indexes.sql — index coverage for a customer's own order
-- history, now that it is paginated
-- =============================================================================
--
-- Run after 033. Idempotent — safe to re-run.
--
-- GET /api/orders/mine (modules/orders/controllers/customer-orders.controller.js)
-- filters `orders` on user_id and sorts on (created_at desc, id desc) — the
-- keyset pagination added alongside this migration reads that exact compound
-- key to decide where one page ends and the next begins — then joins
-- order_items, order_shipping_address and payments by order_id for the page
-- it just cut. None of that was ever proven against a real index: Postgres
-- does not index a foreign key column on your behalf, only a primary key and
-- an explicit unique constraint, and nothing before this migration had asked
-- for any of these four columns by name.
--
-- It went unnoticed because the route always read every order a customer had
-- ever placed, and no account here has placed enough of them yet for a
-- sequential scan to be visible. Both problems are today's real fix: the
-- route now takes a bounded page (customer-orders.controller.js,
-- ORDERS_PAGE_SIZE), and this migration is what makes that page a real index
-- lookup rather than a scan that happens to return quickly today.
--
-- WHAT THIS DOES NOT ADD, AND WHY
-- ---------------------------------------------------------------------------
-- order_shipping_address(order_id) is not below. 012_checkout.sql already
-- created `order_shipping_address_one_per_order_key`, a UNIQUE index on
-- exactly that column (one address row per order) — a second index on the
-- same leading column would only be a slower-to-maintain duplicate of it.
--
-- payments already carries `payments_order_id_idx` (014_razorpay_payments.sql),
-- a single-column index. It is left in place rather than dropped here: this
-- migration is additive index coverage, not a cleanup, and removing an index
-- another route may still be relying on is a separate decision that deserves
-- its own change and its own reasoning, not a rider on this one. The new
-- compound index below is a strict superset of it for any query that filters
-- on order_id alone, so the single-column index becomes redundant weight
-- without becoming wrong.
--
-- CONCURRENTLY, AND WHAT THAT REQUIRES OF WHOEVER RUNS THIS
-- ---------------------------------------------------------------------------
-- These are live tables — orders and payments are written on every checkout,
-- order_items on every one of its lines. A plain CREATE INDEX takes a
-- SHARE lock that blocks writes to the table for as long as the build takes;
-- CONCURRENTLY avoids that at the cost of two scans of the table instead of
-- one. That trade is the only one worth making on tables checkout writes to.
--
-- CONCURRENTLY CANNOT RUN INSIDE A TRANSACTION BLOCK. This file has no
-- BEGIN/COMMIT of its own for exactly that reason — nothing here does — but
-- unlike every other migration in this directory, THIS ONE ALSO CANNOT BE
-- PASTED AS ONE MULTI-STATEMENT BLOCK into a client that wraps the whole
-- paste in an implicit transaction. Run each `create index concurrently`
-- statement below as its own execution (Supabase SQL editor: one statement
-- selected and run at a time, or `psql -f` with autocommit, which is the
-- default). If a tool ever wraps this file in BEGIN/COMMIT automatically,
-- these statements are what will fail, with Postgres saying so directly:
-- "CREATE INDEX CONCURRENTLY cannot run inside a transaction block".
--
-- IF A BUILD IS INTERRUPTED, Postgres can leave an "INVALID" index behind
-- instead of quietly retrying. `IF NOT EXISTS` does not detect that case —
-- an invalid index still exists, it just refuses reads. Check for it with
-- the query at the bottom of this file and, if found, `DROP INDEX
-- CONCURRENTLY` the invalid one and re-run its statement.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. orders — the page itself: "this customer's orders, newest first"
--
--    (user_id, created_at desc, id desc) matches the route's
--    .eq('user_id', ...).order('created_at', desc).order('id', desc) exactly,
--    including the tie-break: two orders placed in the same instant still
--    need `id` to keep the compound key strictly decreasing, which is what
--    makes a keyset cursor built from the last row of one page safe to
--    resume from. A DESC index reads directly in that order; an ASC one
--    would still be used but read backwards, which is a worse plan on a
--    table this route will call on every account-overlay open.
-- -----------------------------------------------------------------------------
create index concurrently if not exists orders_user_id_created_at_id_idx
    on public.orders (user_id, created_at desc, id desc);


-- -----------------------------------------------------------------------------
-- 2. order_items — every line on the current page's orders
--
--    GET /api/orders/mine's second query is
--    order_items.select('*').in('order_id', <this page's order ids>). No
--    index has ever named this column; every call has been a full scan of
--    every line item ever sold, filtered down in memory to the handful that
--    matched.
-- -----------------------------------------------------------------------------
create index concurrently if not exists order_items_order_id_idx
    on public.order_items (order_id);


-- -----------------------------------------------------------------------------
-- 3. payments — "the most recent payment for each of this page's orders"
--
--    customer-orders.controller.js fetches every payments row for the page's
--    order ids and picks the newest per order in JavaScript
--    (paymentByOrder, keyed on order_id, kept on the greatest created_at).
--    (order_id, created_at desc, id desc) lets that lookup — and
--    gatewayPaymentRow()'s equivalent single-order version, used by the
--    cancel and invoice routes — walk straight to the newest row for a given
--    order_id instead of reading every payment that order has ever had.
-- -----------------------------------------------------------------------------
create index concurrently if not exists payments_order_id_created_at_id_idx
    on public.payments (order_id, created_at desc, id desc);


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public'
--    and indexname in (
--      'orders_user_id_created_at_id_idx',
--      'order_items_order_id_idx',
--      'payments_order_id_created_at_id_idx'
--    );
-- Expected: all three present.
--
-- select indexrelid::regclass, indisvalid from pg_index
--  where indexrelid::regclass::text in (
--    'orders_user_id_created_at_id_idx',
--    'order_items_order_id_idx',
--    'payments_order_id_created_at_id_idx'
--  );
-- Expected: indisvalid = true for all three. false means an interrupted
-- CONCURRENTLY build — DROP INDEX CONCURRENTLY that one and re-run its
-- statement above.
-- =============================================================================
