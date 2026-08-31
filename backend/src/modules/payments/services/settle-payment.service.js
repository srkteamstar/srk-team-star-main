/*
 * modules/payments/services/settle-payment.service.js
 * ============================================================================
 *
 * gatewayPaymentRow() and markOrderPaid(): the lookup, and THE ONLY CODE IN
 * THIS APPLICATION THAT MAY WRITE payments.status = 'Paid'.
 *
 * markOrderPaid() ALSO WRITES THE orders TABLE, which is a module reaching
 * across a boundary and is the one place in this codebase that does. It stays
 * that way on purpose. The four checks and the status flip have to be one
 * indivisible decision - asking the gateway, comparing the binding, and
 * clearing 'Pending Payment' - and splitting the write out into an event
 * modules/orders consumed would put a gap between "we proved money moved" and
 * "the order says so", in the one place in the system where that gap is
 * expensive. The final UPDATE is guarded on the awaiting-payment status IN THE
 * WHERE CLAUSE, which is what makes it safe to run twice and what stops a
 * redelivered webhook resurrecting a cancelled order.
 *
 * The deviation is recorded in ARCHITECTURE.md rather than left to be found.
 */
const { supabase } = require('../../../core/database/supabase');
const razorpay = require('../../../core/gateways/razorpay');
const { CURRENCY, PAYMENT_STATUS } = require('../../../shared/contracts/payment');

// The payment row for an order — looked up BY ORDER ID ALONE, deliberately.
//
// Filtering by the presented gateway order id as well would look tidier and
// would quietly disable the most important check in this file. A replayed
// payment names our order and someone else's gateway order; a lookup on both
// simply finds nothing and reports "no payment recorded against that order",
// which is both false and, worse, means the explicit binding comparison in
// markOrderPaid() never executes. The defence has to run to be a defence.
//
// There can be several rows on one order — a failed attempt and a later retry
// — so this takes the most recent, the same rule fetchOrderRows() already uses
// to show one payment against an order.
async function gatewayPaymentRow(orderId) {
    const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('order_id', orderId);

    if (error) throw error;

    return (data || [])
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

/**
 * THE ONLY FUNCTION IN THIS FILE THAT MAY WRITE payments.status = 'Paid'.
 *
 * Called by the checkout callback and by the webhook, and safe to call any
 * number of times for the same payment — which is the whole point, because
 * those two race each other by milliseconds and Razorpay redelivers webhooks
 * on any non-2xx.
 *
 * IT ASKS THE GATEWAY ITSELF, EVERY TIME.
 *
 * Not the request body, and not even a signed webhook's payload. A valid
 * webhook signature proves the delivery is genuine; it does not prove the
 * payload still describes the current state, and trusting it would leave two
 * code paths believing different things. One fetch keeps one truth, and it
 * costs a round trip on a path that runs once per order.
 *
 * FOUR CONDITIONS, ALL REQUIRED
 *
 *   1. captured        an authorised-but-uncaptured payment is not money yet
 *   2. amount          integer paise, exact, against the frozen row
 *   3. currency        a correct number in the wrong currency is not payment
 *   4. order binding   the gateway order id must be the one stored on THIS
 *                      row — this is what refuses a genuine signature
 *                      replayed from a different, cheaper order
 *
 * Condition 4 is the one signature-verification-only integrations miss, and
 * it is why migration 014 added a column to store the binding against.
 */
async function markOrderPaid({ orderId, gatewayPaymentId, gatewayOrderId, source }) {
    const paymentRow = await gatewayPaymentRow(orderId);

    if (!paymentRow) {
        return { ok: false, reason: 'no_payment_row', message: 'No payment is recorded against that order.' };
    }

    // Already done. Returned as success, not as an error: a redelivered
    // webhook and a callback that raced it are both ordinary, and answering
    // with a failure would make Razorpay retry forever.
    if (paymentRow.status === PAYMENT_STATUS.paid) {
        return { ok: true, already: true, paymentRow };
    }

    if (paymentRow.gateway !== 'razorpay' || !paymentRow.gateway_order_id) {
        return { ok: false, reason: 'not_a_gateway_order', message: 'That order was not set up for online payment.' };
    }

    // ---- Condition 4, before spending a round trip on the others.
    if (String(paymentRow.gateway_order_id) !== String(gatewayOrderId)) {
        console.error(
            `PAYMENT REPLAY REFUSED (${source}): order ${orderId} is bound to ${paymentRow.gateway_order_id}, ` +
            `but ${gatewayOrderId} was presented with payment ${gatewayPaymentId}.`
        );
        return { ok: false, reason: 'order_mismatch', message: 'That payment does not belong to this order.' };
    }

    // ---- Ask the gateway.
    let gatewayPayment;
    try {
        gatewayPayment = await razorpay.fetchPayment(gatewayPaymentId);
    } catch (error) {
        // Unreachable is a retry, not a refusal — the webhook will come back,
        // and the customer can be told to wait rather than told they failed.
        if (error.unreachable) {
            return { ok: false, reason: 'gateway_unreachable', message: 'We could not reach the payment provider to confirm. If money left your account, this will settle shortly.' };
        }
        return { ok: false, reason: 'gateway_error', message: 'The payment provider could not confirm that payment.' };
    }

    // Authorised is not a mismatch — it is money in flight that has not
    // finished clearing. Refusing to call it Paid is correct; writing Failed
    // for it is not, because a genuine capture is very likely still coming.
    // Left at 'Created' so that later capture settles through the normal
    // path with nothing here to undo first.
    if (gatewayPayment.status === 'authorized') {
        return {
            ok: false,
            reason: 'authorized_pending_capture',
            message: 'Your payment is authorized and awaiting confirmation. Please wait a moment and check again.'
        };
    }

    const mismatches = [];
    if (gatewayPayment.status !== 'captured') mismatches.push(`status=${gatewayPayment.status}`);
    if (Number(gatewayPayment.amount) !== Number(paymentRow.amount_paise)) {
        mismatches.push(`amount=${gatewayPayment.amount} expected ${paymentRow.amount_paise}`);
    }
    if (String(gatewayPayment.currency) !== String(paymentRow.currency)) {
        mismatches.push(`currency=${gatewayPayment.currency} expected ${paymentRow.currency}`);
    }
    if (String(gatewayPayment.order_id) !== String(paymentRow.gateway_order_id)) {
        mismatches.push(`order_id=${gatewayPayment.order_id} expected ${paymentRow.gateway_order_id}`);
    }

    if (mismatches.length) {
        // Loud, and left unpaid. A mismatch here is either a bug or an
        // attempt, and both want a human. The order is NOT cancelled: if money
        // really did move, cancelling would hide it.
        console.error(`PAYMENT VERIFICATION FAILED (${source}) for order ${orderId}, payment ${gatewayPaymentId}: ${mismatches.join('; ')}`);

        // Guarded on the row still being 'Created', atomically in the WHERE
        // clause rather than trusted from the read at the top of this
        // function. Without it, a stale or replayed capture event that no
        // longer matches (say, the gateway now reports the payment refunded)
        // could downgrade an already-settled Refunded/Paid row back to
        // Failed. Only a payment nobody has yet confirmed may become Failed.
        const { error } = await supabase.from('payments')
            .update({ status: PAYMENT_STATUS.failed, transaction_id: gatewayPaymentId })
            .eq('id', paymentRow.id)
            .eq('status', PAYMENT_STATUS.created);
        if (error) throw error;

        return { ok: false, reason: 'mismatch', message: 'That payment could not be verified against this order.' };
    }

    // ---- It is real. Record the money and move the order in one database
    // transaction. This is also the lock boundary with customer cancellation:
    // whichever transaction wins is visible to the other before it decides.
    //
    // payment_method now carries what the gateway OBSERVED (card / upi /
    // netbanking / …) rather than what the customer said they intended, which
    // is the widening migration 014 documents on that column.
    const settled = await supabase.rpc('settle_captured_store_payment', {
        p_order_id: orderId,
        p_payment_id: paymentRow.id,
        p_transaction_id: gatewayPaymentId,
        p_payment_method: gatewayPayment.method || null,
        p_verified_at: new Date().toISOString()
    });

    if (settled.error) {
        // 23505 is the unique index on transaction_id (migration 014 §4a)
        // saying this payment is already recorded. A duplicate means it
        // already happened.
        if (settled.error.code === '23505') return { ok: true, already: true, paymentRow };
        throw settled.error;
    }

    const result = Array.isArray(settled.data) ? settled.data[0] : settled.data;
    if (result && result.requires_review) {
        console.error(`PAYMENT REVIEW REQUIRED: order ${orderId} captured after cancellation (${gatewayPaymentId}).`);
    }

    console.log(`Payment verified (${source}): order ${orderId}, payment ${gatewayPaymentId}, ${paymentRow.amount_paise} paise.`);
    return {
        ok: true,
        already: Boolean(result && result.already),
        requiresReview: Boolean(result && result.requires_review),
        paymentRow: result && result.payment ? result.payment : paymentRow
    };
}

module.exports = { gatewayPaymentRow, markOrderPaid };
