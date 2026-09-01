-- =============================================================================
-- 034_refund_ledger.sql — refund idempotency, by Razorpay's own refund id
-- =============================================================================
--
-- Run after 033. Idempotent — safe to re-run.
--
-- THE GAP THIS CLOSES
-- --------------------
-- Before this file, a refund.processed webhook was "handled" by adding its
-- amount straight onto `payments` and then, separately, stamping the event
-- row processed. Those are two writes, not one, and Razorpay retries a
-- webhook on anything but a 2xx — so if the process died between them, or two
-- deliveries for the same refund overlapped, the amount could be added twice.
-- There was no per-refund identifier anywhere to notice: the second delivery
-- looked exactly like a first one.
--
-- WHAT THIS FILE ADDS
-- --------------------
-- 1. `store_refunds` — one row per Razorpay refund id, ever. The primary key
--    IS the idempotency guarantee, the same role migration 014's
--    payments_transaction_id_key plays for captures.
-- 2. `apply_verified_refund()` — the only code that may move a payment INTO
--    'Partially Refunded' or 'Refunded'. One transaction: claim the refund id
--    with INSERT ... ON CONFLICT DO NOTHING, apply the amount only when that
--    insert actually claimed a previously-unseen row, and update the ledger
--    and the payment together or not at all.
--
-- THE THREE OUTCOMES A CALLER MUST DISTINGUISH
-- -----------------------------------------------
-- Webhooks do not arrive in order (Razorpay does not promise it), so a
-- refund can genuinely reach this function before the matching capture has
-- settled locally. Returning a single boolean cannot describe that, so the
-- function returns one of three explicit strings instead:
--
--   'applied'            this call is the one that recorded the refund.
--   'already_applied'    a PRIOR call already recorded this exact refund id,
--                         for the same payment, amount and currency. A
--                         redelivery — the safe, ordinary case.
--   'not_yet_applicable' the payment has not reached a captured state here
--                         yet (Created / Failed). NOTHING WAS WRITTEN, not
--                         even the ledger row — so the very next delivery of
--                         the same event, after the capture settles, is free
--                         to apply it. See 038_preserve_refund_status_on_
--                         settlement.sql and payments.controller.js, which
--                         must leave an event in this state retryable rather
--                         than marking it processed.
--
-- A DUPLICATE ID WITH A DIFFERENT AMOUNT OR CURRENCY IS NOT A DUPLICATE
-- -----------------------------------------------------------------------
-- Two deliveries that name the same refund id but disagree on amount,
-- currency or which payment they refund are not the same event arriving
-- twice — they are a bug or a forgery, and merging them silently would
-- corrupt the ledger they exist to protect. This function raises rather than
-- accepting either version.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The ledger
--
--    payment_id has a real foreign key, unlike payment_events.order_id —
--    every refund names a specific payments row this function itself
--    resolved and locked; there is no "arrived naming something that does
--    not exist" case the way an inbound webhook has.
--
--    gateway_payment_id (Razorpay's pay_xxx) is stored alongside the refund
--    for the same reason payments.gateway_order_id exists: so a refund can be
--    bound to the transaction it claims to refund and a mismatch is a
--    detectable, refusable condition rather than a trusted claim.
-- -----------------------------------------------------------------------------
create table if not exists public.store_refunds (
    gateway            text        not null,
    refund_id          text        not null,
    payment_id         bigint      not null references public.payments(id),
    gateway_payment_id text,
    amount_paise       bigint      not null check (amount_paise > 0),
    currency           text        not null,
    status             text,
    created_at         timestamptz not null default now(),
    primary key (gateway, refund_id)
);

comment on table public.store_refunds is
    'One row per Razorpay refund id, ever. The primary key is the whole idempotency guarantee — see apply_verified_refund(). Written only by that function.';
comment on column public.store_refunds.payment_id is
    'The payments row this refund reduces. Real FK: every row here was resolved and locked by apply_verified_refund() before being inserted, unlike payment_events, which must also record events naming an order that does not exist.';
comment on column public.store_refunds.gateway_payment_id is
    'Razorpay pay_xxx this refund claims to be against. Compared to payments.transaction_id — the refund equivalent of gateway_order_id binding on a capture.';

create index if not exists store_refunds_payment_id_idx
    on public.store_refunds (payment_id);


-- -----------------------------------------------------------------------------
-- 2. Row level security and grants — service_role only, same posture as
--    payments and payment_events. No table-level INSERT/UPDATE grant to
--    service_role: the only writer is apply_verified_refund(), which is
--    SECURITY DEFINER and therefore does not need one. SELECT is granted for
--    reconciliation/inspection tooling that reads the ledger directly.
-- -----------------------------------------------------------------------------
alter table public.store_refunds enable row level security;

revoke all on table public.store_refunds from public, anon, authenticated;
grant select on table public.store_refunds to service_role;


-- -----------------------------------------------------------------------------
-- 3. apply_verified_refund() — the only writer of store_refunds, and the
--    only code that may move payments.status to 'Partially Refunded' or
--    'Refunded'.
--
--    LOCK ORDER. This function locks exactly one payments row and nothing in
--    orders — it never needs the order row, because a refund changes what
--    was paid, not what is being fulfilled. settle_captured_store_payment()
--    (033/035) locks orders THEN payments; this function never acquires
--    orders at all, so the two cannot deadlock against each other: there is
--    no path where this function is holding payments and waiting on orders.
-- -----------------------------------------------------------------------------
create or replace function public.apply_verified_refund(
    p_order_id bigint,
    p_payment_id bigint,
    p_gateway text,
    p_gateway_order_id text,
    p_gateway_payment_id text,
    p_refund_id text,
    p_amount_paise bigint,
    p_currency text,
    p_refund_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment    public.payments%rowtype;
    v_existing   public.store_refunds%rowtype;
    v_prior_sum  bigint;
    v_new_sum    bigint;
    v_new_status text;
    v_rows       integer;
begin
    if p_refund_id is null or length(trim(p_refund_id)) = 0 then
        raise exception 'refund id is required';
    end if;
    if p_amount_paise is null or p_amount_paise <= 0 then
        raise exception 'invalid refund amount';
    end if;

    select * into v_payment from public.payments
     where id = p_payment_id and order_id = p_order_id
     for update;
    if not found then
        raise exception 'payment not found for refund';
    end if;

    -- Bound to the SAME order a capture would be: gateway and the Razorpay
    -- order id stored on this row. Both are set at checkout time, before any
    -- capture, so both are meaningful to check regardless of whether this
    -- payment has settled here yet. A refund naming either differently is
    -- not a refund of THIS payment, whatever else it claims.
    if v_payment.gateway is distinct from p_gateway
        or v_payment.gateway_order_id is distinct from p_gateway_order_id then
        raise exception 'refund payment binding mismatch';
    end if;

    if v_payment.currency is distinct from p_currency then
        raise exception 'refund currency mismatch';
    end if;

    -- Not captured here yet. Razorpay does not guarantee webhook ordering,
    -- so a refund can genuinely arrive before the matching capture settles —
    -- and until it does, payments.transaction_id is still null, which is why
    -- the transaction-id binding check below has to wait until AFTER this
    -- gate rather than run alongside gateway_order_id above: checking it
    -- early would read every legitimately-early refund as a binding
    -- mismatch instead of the "not yet" it actually is. Nothing is written
    -- here — not even the ledger row — so a later delivery of this SAME
    -- event is free to apply once the payment reaches a captured state, and
    -- this call is idempotent by having done nothing.
    if v_payment.status not in ('Paid', 'Partially Refunded', 'Refunded') then
        return jsonb_build_object('status', 'not_yet_applicable', 'payment', to_jsonb(v_payment));
    end if;

    -- Captured, so transaction_id is now populated and meaningful: the
    -- Razorpay payment id this refund claims to be against must be the one
    -- this row was actually captured under.
    if v_payment.transaction_id is distinct from p_gateway_payment_id then
        raise exception 'refund payment binding mismatch';
    end if;

    select coalesce(sum(amount_paise), 0) into v_prior_sum
      from public.store_refunds where payment_id = v_payment.id;

    select * into v_existing from public.store_refunds
     where gateway = p_gateway and refund_id = p_refund_id;

    if found then
        -- A redelivery of a refund id already recorded. Same payment, same
        -- amount, same currency: an ordinary retry, acknowledged again with
        -- no further write. Anything else is not the same event twice.
        if v_existing.payment_id is distinct from v_payment.id
            or v_existing.amount_paise is distinct from p_amount_paise
            or v_existing.currency is distinct from p_currency then
            raise exception 'refund identity mismatch: refund % was already recorded against payment %, % %, and cannot also be payment %, % %',
                p_refund_id, v_existing.payment_id, v_existing.amount_paise, v_existing.currency,
                v_payment.id, p_amount_paise, p_currency;
        end if;

        return jsonb_build_object('status', 'already_applied', 'payment', to_jsonb(v_payment));
    end if;

    if (v_prior_sum + p_amount_paise) > v_payment.amount_paise then
        raise exception 'refund exceeds payment amount';
    end if;

    insert into public.store_refunds (
        gateway, refund_id, payment_id, gateway_payment_id, amount_paise, currency, status
    ) values (
        p_gateway, p_refund_id, v_payment.id, p_gateway_payment_id, p_amount_paise, p_currency, p_refund_status
    )
    on conflict (gateway, refund_id) do nothing;

    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        -- Lost a race with a concurrent call that claimed this exact refund
        -- id between the SELECT above and this INSERT. Re-read and treat
        -- precisely like the redelivery case above.
        select * into v_existing from public.store_refunds
         where gateway = p_gateway and refund_id = p_refund_id;

        if v_existing.payment_id is distinct from v_payment.id
            or v_existing.amount_paise is distinct from p_amount_paise
            or v_existing.currency is distinct from p_currency then
            raise exception 'refund identity mismatch: refund % was already recorded against payment %, % %, and cannot also be payment %, % %',
                p_refund_id, v_existing.payment_id, v_existing.amount_paise, v_existing.currency,
                v_payment.id, p_amount_paise, p_currency;
        end if;

        return jsonb_build_object('status', 'already_applied', 'payment', to_jsonb(v_payment));
    end if;

    -- The amount is applied by recomputing the ledger's own sum, not by
    -- adding a delta to whatever payments.status/amount held before — so a
    -- bug anywhere else in this function cannot double-count even in
    -- principle. This insert already claimed the row, so it is counted once.
    select coalesce(sum(amount_paise), 0) into v_new_sum
      from public.store_refunds where payment_id = v_payment.id;

    v_new_status := case when v_new_sum >= v_payment.amount_paise then 'Refunded' else 'Partially Refunded' end;

    update public.payments set status = v_new_status
     where id = v_payment.id
     returning * into v_payment;

    return jsonb_build_object('status', 'applied', 'payment', to_jsonb(v_payment));
end;
$$;

revoke all on function public.apply_verified_refund(bigint,bigint,text,text,text,text,bigint,text,text)
    from public, anon, authenticated;
grant execute on function public.apply_verified_refund(bigint,bigint,text,text,text,text,bigint,text,text)
    to service_role;

comment on function public.apply_verified_refund(bigint,bigint,text,text,text,text,bigint,text,text) is
    'Server-only atomic refund application. Deduplicates by (gateway, refund_id) via store_refunds, not by webhook delivery completion. Returns status: applied / already_applied / not_yet_applicable. Rejects a duplicate refund id whose amount/currency/payment disagrees with the first sighting.';


-- -----------------------------------------------------------------------------
-- 4. Retire the superseded writer.
--
--    An EARLIER revision of this same file (034) created
--    apply_store_refund(bigint,bigint) — the additive, no-refund-id writer
--    that finding F03 is about. It adds a caller-supplied delta straight onto
--    payments.refunded_amount_paise with nothing to notice a redelivery by,
--    which is exactly the double-count this file exists to close.
--
--    On any database where that earlier 034 was already applied, the old
--    function is still present and still granted to service_role, so the
--    vulnerable path remains callable even though no application code calls
--    it any more. Leaving a dead, exploitable RPC in place is not a fix, so
--    drop it here. On a fresh database this is a no-op.
--
--    payments.refunded_amount_paise is deliberately NOT dropped: on an
--    already-migrated database it may hold history worth reconciling against
--    store_refunds before anyone removes it, and a migration that destroys
--    financial columns is not a decision this file should make. It is no
--    longer read or written by any code — the refunded total is now derived
--    from sum(store_refunds.amount_paise). Treat it as stale.
-- -----------------------------------------------------------------------------
drop function if exists public.apply_store_refund(bigint, bigint);


-- -----------------------------------------------------------------------------
-- 5. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- -- 1. The ledger exists with the right primary key.
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.store_refunds'::regclass and contype = 'p';
-- Expected: PRIMARY KEY (gateway, refund_id).
--
-- -- 2. Nothing leaked to the browser's key.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'store_refunds' and grantee in ('anon','authenticated');
-- Expected: 0 rows.
--
-- -- 3. The function is service_role-only.
-- select grantee, privilege_type from information_schema.role_routine_grants
--  where routine_name = 'apply_verified_refund';
-- Expected: exactly one row, service_role / EXECUTE.
--
-- -- 4. Applying the same refund id twice is one row, not two.
-- -- (run against a payment already 'Paid', substituting real ids)
-- -- select apply_verified_refund(<order>, <payment>, 'razorpay', '<gw_order>',
-- --   '<gw_payment>', 'rfnd_test_1', 100, 'INR', 'processed');
-- -- select apply_verified_refund(<order>, <payment>, 'razorpay', '<gw_order>',
-- --   '<gw_payment>', 'rfnd_test_1', 100, 'INR', 'processed');
-- select count(*) from public.store_refunds where refund_id = 'rfnd_test_1';
-- Expected: 1.
-- =============================================================================
