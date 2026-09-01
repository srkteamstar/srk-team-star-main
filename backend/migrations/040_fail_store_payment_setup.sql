-- Retire an order whose Razorpay handshake never happened, in one transaction.
--
-- checkout.controller.js writes the order and its 'Created' payment row first
-- (migration 025's create_store_order, atomic on its own) and only then asks
-- Razorpay for an order to pay against — see that file's header for why the
-- sequence is the security model. When THAT call fails, the local rows are
-- already committed and durable, and two separate, unchecked `.update()`
-- calls used to retire them: one for the order, one for the payment. Either
-- write could fail on its own, or the process could die between them, and
-- whichever one landed stuck around alone — an order stuck 'Pending Payment'
-- that no customer can ever pay, or a payment stuck 'Created' against an
-- order already 'Cancelled'.
--
-- The admin dashboard (a separate repository, sharing only this database)
-- hides an order from its live queue on exactly one shape: `orders.status =
-- 'Cancelled'` AND that order's most-recent-by-created_at payment row has
-- `status = 'Failed'`. That is how it tells an abandoned checkout attempt
-- from a real one, and it is read straight off these two columns — there is
-- no third "attempt" flag anywhere. A half-applied write leaves a row in
-- neither shape it is allowed to be in: still-live-looking, or an orphaned
-- payment against a cancelled order that never reads as an abandoned attempt
-- at all.
--
-- So both writes happen here, guarded and together. Both rows are locked
-- `for update` before anything is read, so this cannot interleave with
-- migration 033's settle_captured_store_payment or with the cancellation
-- route racing the same order — one of the two lockers waits for the other
-- to commit and then sees its result rather than a half-updated row.
--
-- Pre-failure state is checked, not assumed: order 'Pending Payment' (the
-- status create_store_order gives an online order — see order-status.js's
-- ORDER_STATUS_AWAITING_PAYMENT) and payment 'Created' (the status an online
-- payment row is written with — see payment.js's PAYMENT_STATUS.created,
-- and migration 014's check constraint for the full enum). If either row has
-- already moved — the gateway call actually succeeded and a later race paid
-- it, an operator already touched it, a previous call already retired it —
-- this refuses rather than clobbering whatever is really going on, with one
-- idempotent exception: a retry landing after the first call's response was
-- lost must not fail merely because the job is already done.
create or replace function public.fail_store_payment_setup(
    p_order_id bigint,
    p_payment_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
    v_payment public.payments%rowtype;
begin
    select * into v_order from public.orders
     where id = p_order_id for update;
    if not found then raise exception 'order not found'; end if;

    select * into v_payment from public.payments
     where id = p_payment_id and order_id = p_order_id for update;
    if not found then raise exception 'payment not found for order'; end if;

    -- Already retired by an earlier call to this same function. A caller
    -- that retries after losing the RPC's response must see success, not a
    -- refusal for work that already happened.
    if v_order.status = 'Cancelled' and v_payment.status = 'Failed' then
        return;
    end if;

    if v_order.status <> 'Pending Payment' or v_payment.status <> 'Created' then
        raise exception
            'order % / payment % are not in the pre-failure state (order status=%, payment status=%)',
            p_order_id, p_payment_id, v_order.status, v_payment.status;
    end if;

    update public.orders set status = 'Cancelled' where id = v_order.id;
    update public.payments set status = 'Failed' where id = v_payment.id;
end;
$$;

revoke all on function public.fail_store_payment_setup(bigint,bigint)
    from public, anon, authenticated;
grant execute on function public.fail_store_payment_setup(bigint,bigint)
    to service_role;

comment on function public.fail_store_payment_setup(bigint,bigint) is
    'Server-only atomic retirement of an order whose Razorpay order-creation call failed: Pending Payment -> Cancelled and Created -> Failed together, or neither.';

notify pgrst, 'reload schema';
