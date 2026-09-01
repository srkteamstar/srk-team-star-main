-- =============================================================================
-- 038_preserve_refund_status_on_settlement.sql — a later capture cannot
-- un-refund a payment
-- =============================================================================
--
-- Run after 034 (apply_verified_refund() and store_refunds must already
-- exist — this file only touches settle_captured_store_payment()).
--
-- NUMBERED 038, NOT 035. This file was written against a tree whose
-- migrations stopped at 034, so it originally claimed 035 — which was
-- already taken by 035_checkout_idempotency.sql. Renumbered at integration.
-- Nothing between 035 and 037 touches settle_captured_store_payment(), so
-- running it here rather than at 035 changes nothing about the result.
-- Idempotent — safe to re-run: CREATE OR REPLACE against an unchanged
-- signature.
--
-- THE BUG
-- -------
-- 033's settle_captured_store_payment() only short-circuited on
-- payments.status = 'Paid'. Every other status — including 'Partially
-- Refunded' and 'Refunded', which 034 now writes — fell to the else branch
-- and was unconditionally rewritten back to 'Paid'. Razorpay does not
-- guarantee webhook ordering: a payment.captured delivery can genuinely
-- arrive, or be redelivered, AFTER the matching refund.processed already
-- moved the row past Paid. That later capture must be recognised as "this
-- already happened" and leave the refunded state alone — exactly as an
-- already-Paid row already was.
--
-- THE FIX
-- -------
-- Widen the already-applied branch from `status = 'Paid'` to
-- `status in ('Paid', 'Partially Refunded', 'Refunded')`, still verifying
-- transaction identity before treating it as already-applied — a DIFFERENT
-- transaction claiming to have captured an already-captured payment is a bug
-- or an attempt, not a redelivery, and stays refused exactly as it was.
--
-- Everything else — the orders lock, the Payment Review routing for a
-- capture that lands after cancellation, the lock ORDER (orders, then
-- payments, matching every other writer in this file) — is unchanged.
-- =============================================================================

create or replace function public.settle_captured_store_payment(
    p_order_id bigint,
    p_payment_id bigint,
    p_transaction_id text,
    p_payment_method text,
    p_verified_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment public.payments%rowtype;
    v_order public.orders%rowtype;
    v_already boolean := false;
begin
    select * into v_order from public.orders
     where id = p_order_id for update;
    if not found then raise exception 'order not found'; end if;

    select * into v_payment from public.payments
     where id = p_payment_id and order_id = p_order_id for update;
    if not found then raise exception 'payment not found for order'; end if;

    if v_payment.status in ('Paid', 'Partially Refunded', 'Refunded') then
        if v_payment.transaction_id is distinct from p_transaction_id then
            raise exception 'order is already paid by a different transaction';
        end if;
        -- Already captured, in whatever post-capture state the refund
        -- ledger (034) has since moved it to. A later or out-of-order
        -- capture event must not regress Partially Refunded / Refunded back
        -- to Paid — that regression was the entirety of finding F04.
        v_already := true;
    else
        update public.payments set
            transaction_id = p_transaction_id,
            status = 'Paid',
            payment_method = p_payment_method,
            verified_at = p_verified_at
        where id = v_payment.id
        returning * into v_payment;
    end if;

    if v_order.status = 'Pending Payment' then
        update public.orders set status = 'Processing'
         where id = v_order.id returning * into v_order;
    elsif v_order.status = 'Cancelled' then
        -- Money arrived after cancellation won the lock. Do not fulfil and do
        -- not hide the capture: put the order in an explicit operator queue.
        update public.orders set status = 'Payment Review'
         where id = v_order.id returning * into v_order;
    end if;

    return jsonb_build_object(
        'already', v_already,
        'payment', to_jsonb(v_payment),
        'order_status', v_order.status,
        'requires_review', v_order.status = 'Payment Review'
    );
end;
$$;

revoke all on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)
    from public, anon, authenticated;
grant execute on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)
    to service_role;

comment on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz) is
    'Server-only atomic settlement. Preserves Paid/Partially Refunded/Refunded against a later out-of-order capture, verifying transaction identity before treating any of them as already-applied. Serializes with cancellation and routes a post-cancellation capture to Payment Review.';

notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- -- 1. The function still exists with the same signature (CREATE OR REPLACE
-- --    would have failed loudly otherwise).
-- select pg_get_functiondef('public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)'::regprocedure);
-- Expected: definition includes "'Paid', 'Partially Refunded', 'Refunded'".
--
-- -- 2. A Refunded payment resettled with the SAME transaction id reports
-- --    already=true and stays Refunded (substitute real ids; the payment
-- --    row must already be 'Refunded', e.g. via 034's apply_verified_refund).
-- -- select settle_captured_store_payment(<order>, <payment>, '<txn>', 'upi', now());
-- select status from public.payments where id = <payment>;
-- Expected: Refunded, not Paid.
-- =============================================================================
