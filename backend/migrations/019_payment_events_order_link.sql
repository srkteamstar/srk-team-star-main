-- =============================================================================
-- 019_payment_events_order_link.sql — the webhook could never file its own work
-- =============================================================================
--
-- Run after 018. Idempotent — safe to re-run.
--
-- WHAT WAS BROKEN
-- ---------------
-- Every webhook delivery landed, verified and was acted on correctly — and
-- then failed to record WHICH ORDER it belonged to. `payment_events.order_id`
-- was null on every row in the table, including deliveries that had just
-- successfully marked an order paid.
--
-- The cause is the intersection of a deliberate design and a line added after
-- it. 014 made this table append-only by granting UPDATE **per column**:
--
--     grant update (processed_at, process_error) on public.payment_events
--         to service_role;
--
-- which is a good idea and the reason the evidence in this table cannot be
-- rewritten. But POST /api/webhooks/razorpay resolves our order id from the
-- event and then does:
--
--     await supabase.from('payment_events')
--         .update({ order_id: orderId }).eq('id', eventRow.id);
--
-- `order_id` is not in that grant list, so PostgREST answered 42501
-- "permission denied for table payment_events" every single time. The route
-- ignores the result of that call, so nothing was logged, nothing failed, and
-- the only visible symptom was an audit trail that could not be joined to the
-- orders it described — `inspect-order.js` reporting "no webhook arrived for
-- this order" about an order whose webhook had arrived and worked.
--
-- WHY THE GRANT IS THE RIGHT FIX, NOT THE ROUTE
-- ---------------------------------------------
-- The obvious alternative is to set order_id at INSERT time and never update
-- it. That would be stricter, and it is wrong here: section 1 of the route
-- records the delivery BEFORE interpreting it, deliberately, so that a
-- payload which cannot be understood is still evidence. Resolving the order
-- can require a database lookup (the fallback by gateway_order_id), and making
-- the append wait on a query is exactly the coupling that design avoids.
--
-- So the link is written afterwards, and the grant has to allow it.
--
-- THIS DOES NOT WEAKEN "APPEND-ONLY"
-- ----------------------------------
-- The property worth protecting is that the EVIDENCE cannot be rewritten:
-- `payload`, `signature_verified`, `event_id`, `event_type`, `received_at`.
-- None of those become updatable here. `order_id` is a derived cross-reference
-- this server computes from the payload — the same category as `processed_at`
-- and `process_error`, which 014 already made updatable for the same reason.
--
-- Still not granted, and deliberately: UPDATE on any evidence column, and
-- DELETE on anything at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The missing column privilege
--
--    Additive: this does not replace the grant from 014, it extends it. A
--    column grant is per column, so naming all three keeps the statement
--    readable as the complete set of what may be written after insert.
-- -----------------------------------------------------------------------------
grant update (order_id, processed_at, process_error)
    on public.payment_events to service_role;


-- -----------------------------------------------------------------------------
-- 2. Backfill the rows that were written while the grant was missing
--
--    Every affected row already carries `gateway_order_id`, and `payments`
--    carries the same value against the order it belongs to — which is the
--    identical fallback the route itself uses. So the link is recoverable
--    without guessing, and the history becomes queryable rather than staying
--    permanently blank.
--
--    Only rows where order_id IS NULL are touched, so a re-run does nothing
--    and no correctly-linked row is ever rewritten.
-- -----------------------------------------------------------------------------
update public.payment_events e
   set order_id = p.order_id
  from public.payments p
 where e.order_id is null
   and e.gateway_order_id is not null
   and p.gateway_order_id = e.gateway_order_id;


-- -----------------------------------------------------------------------------
-- 3. Refresh PostgREST's schema cache.
--
--    Column privileges are part of what PostgREST caches, so without this the
--    route keeps answering 42501 against a grant that now exists — which looks
--    exactly like the migration not having worked.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The three writable columns, and only those three.
-- select column_name, privilege_type
--   from information_schema.column_privileges
--  where grantee = 'service_role' and table_name = 'payment_events'
--    and privilege_type = 'UPDATE'
--  order by column_name;
-- Expected: order_id, process_error, processed_at. If `payload` or
-- `signature_verified` appears here, the evidence is rewritable — fix that.
--
-- -- 2. The backfill found its targets.
-- select count(*) filter (where order_id is null)     as unlinked,
--        count(*) filter (where order_id is not null) as linked
--   from public.payment_events;
-- Expected: `linked` covers every delivery that carried a gateway_order_id.
-- Rows that legitimately have none — a probe, a malformed delivery, an event
-- for an order this server never created — stay null, which is correct.
--
-- -- 3. Nothing can be deleted, still.
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'service_role' and table_name = 'payment_events';
-- Expected: SELECT, INSERT, UPDATE. Never DELETE.
-- =============================================================================
