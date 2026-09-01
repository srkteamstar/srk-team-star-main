/*
 * modules/payments/services/apply-refund.service.js
 * ============================================================================
 *
 * applyVerifiedRefund(): the only code in this application that may write
 * payments.status = 'Partially Refunded' or 'Refunded'. The counterpart to
 * settle-payment.service.js's markOrderPaid() — that file owns 'Paid', this
 * one owns what happens to a payment after Razorpay refunds some or all of
 * it.
 *
 * REFUNDS ARE RECORDED, NEVER INITIATED HERE. Nothing in this codebase can
 * ask Razorpay to refund a payment; a refund is an action taken in the
 * Razorpay dashboard, and refund.processed is how this ledger learns it
 * happened. This function's whole job is making that learning idempotent and
 * safe against out-of-order delivery.
 *
 * WHY THIS IS A DATABASE FUNCTION AND NOT TWO QUERIES FROM HERE
 * ---------------------------------------------------------------
 * "Add this refund's amount to the payment, then mark the delivery
 * processed" is two writes. If the process dies between them, or two
 * deliveries for the same refund overlap, the amount can be applied twice
 * with nothing anywhere recording that it already happened once — there was
 * no per-refund identifier at all before migration 034. apply_verified_refund()
 * (034) claims the refund id with INSERT ... ON CONFLICT DO NOTHING and
 * updates the payment in the SAME transaction, so "claimed the id" and
 * "applied the amount" cannot come apart.
 *
 * THE THREE-WAY RESULT, NOT A BOOLEAN
 * -------------------------------------
 * Razorpay does not guarantee webhook ordering: a refund can arrive before
 * the matching capture has settled here. `status` on the RPC's response is
 * one of:
 *
 *   'applied'             this call recorded the refund.
 *   'already_applied'     a prior call already recorded this exact refund id
 *                         for this payment, amount and currency — an
 *                         ordinary redelivery.
 *   'not_yet_applicable'  the payment is not in a captured state yet. Nothing
 *                         was written. The caller (payments.controller.js)
 *                         MUST leave this event retryable rather than marking
 *                         it processed — see F05.
 *
 * A duplicate refund id whose amount, currency or payment disagrees with the
 * first sighting is rejected by the database function with an exception,
 * translated here into `{ ok: false, reason: 'inconsistent_duplicate' }` — a
 * terminal rejection, not something worth retrying.
 */
const { supabase } = require('../../../core/database/supabase');

// Exception messages 034's apply_verified_refund() raises for conditions
// that are a bug or an attempt, not a transient failure — these are refused
// outright rather than retried. Matched by prefix because the identity
// mismatch message includes the specific ids for the operator log.
const REJECT_REASONS = [
    { prefix: 'payment not found for refund', reason: 'no_payment_row' },
    { prefix: 'refund payment binding mismatch', reason: 'order_mismatch' },
    { prefix: 'refund currency mismatch', reason: 'currency_mismatch' },
    { prefix: 'refund identity mismatch', reason: 'inconsistent_duplicate' },
    { prefix: 'refund exceeds payment amount', reason: 'amount_exceeds_payment' },
    { prefix: 'invalid refund amount', reason: 'invalid_amount' },
    { prefix: 'refund id is required', reason: 'invalid_refund_id' }
];

function classify(error) {
    const message = String((error && error.message) || '');
    const match = REJECT_REASONS.find((entry) => message.startsWith(entry.prefix));
    return match ? match.reason : null;
}

/**
 * @param {object} args
 * @param {number} args.orderId
 * @param {number} args.paymentId    the payments.id this refund reduces
 * @param {string} args.gateway      'razorpay'
 * @param {string} args.gatewayOrderId
 * @param {string} args.gatewayPaymentId  Razorpay pay_xxx this refund is against
 * @param {string} args.refundId     Razorpay rfnd_xxx — the idempotency key
 * @param {number} args.amountPaise
 * @param {string} args.currency
 * @param {string|null} [args.refundStatus]  Razorpay's own refund.status, informational
 */
async function applyVerifiedRefund({
    orderId, paymentId, gateway, gatewayOrderId, gatewayPaymentId,
    refundId, amountPaise, currency, refundStatus
}) {
    const { data, error } = await supabase.rpc('apply_verified_refund', {
        p_order_id: orderId,
        p_payment_id: paymentId,
        p_gateway: gateway,
        p_gateway_order_id: gatewayOrderId,
        p_gateway_payment_id: gatewayPaymentId,
        p_refund_id: refundId,
        p_amount_paise: amountPaise,
        p_currency: currency,
        p_refund_status: refundStatus || null
    });

    if (error) {
        const reason = classify(error);
        // A reason this file recognises is a deliberate refusal from inside
        // the function — a bug or an attempt, and retrying it will not help.
        // Anything else is unexpected (a connection error, a genuine 500)
        // and is thrown so the caller's catch-all turns it into a 500 that
        // asks Razorpay to redeliver, the same posture markOrderPaid() takes
        // on an unrecognised RPC error.
        if (reason) return { ok: false, reason, message: error.message };
        throw error;
    }

    return {
        ok: true,
        status: data && data.status,
        already: data && data.status === 'already_applied',
        notYetApplicable: data && data.status === 'not_yet_applicable',
        paymentRow: data && data.payment
    };
}

module.exports = { applyVerifiedRefund };
