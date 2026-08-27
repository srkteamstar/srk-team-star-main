/*
 * modules/payments/controllers/payments.controller.js
 * ============================================================================
 *
 *   POST /api/payments/verify     the browser comes back from the modal
 *   POST /api/webhooks/razorpay   Razorpay comes back, and is the authority
 *
 * BOTH 404 WHEN THE GATEWAY IS OFF, rather than 500 or 403. With
 * PAYMENTS_ENABLED unset there is no gateway flow at all, and a route that
 * exists but refuses is a route somebody can learn the shape of.
 *
 * THE WEBHOOK RECORDS BEFORE IT INTERPRETS. Its first act is an append to
 * payment_events - raw payload, plus whether the signature verified - INCLUDING
 * deliveries that fail verification. A handler that verifies, acts and returns
 * 200 has destroyed its own evidence, and the signature_verified = false rows
 * are the only visibility into somebody probing the endpoint.
 */
const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../../../core/database/supabase');
const razorpay = require('../../../core/gateways/razorpay');
const { PAYMENTS_ENABLED } = require('../../../core/config/payments');
const { optionalId, trimmed } = require('../../../shared/validation');
const { PAYMENT_STATUS } = require('../../../shared/contracts/payment');
const { orderReference } = require('../../../shared/contracts/order-reference');
const { gatewayPaymentRow, markOrderPaid } = require('../services/settle-payment.service');
const { verifyLimiter } = require('../infrastructure/payment-rate-limit');

/** @returns {import('express').Router} */
function paymentsController() {
    const router = express.Router();

    // ---- The browser comes back ------------------------------------------------
    //
    // Razorpay's handler fires in the page and posts the three strings here. This
    // route exists so the customer sees a confirmation immediately; it is not what
    // makes the order paid — markOrderPaid() is, and the webhook would reach the
    // same conclusion without this route ever being called.
    router.post('/api/payments/verify', verifyLimiter, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        if (!PAYMENTS_ENABLED) return res.status(404).json({ error: "Not found." });

        const body = req.body || {};
        const orderId = optionalId(body.order_id);
        const gatewayOrderId = trimmed(body.razorpay_order_id);
        const gatewayPaymentId = trimmed(body.razorpay_payment_id);
        const signature = trimmed(body.razorpay_signature);

        if (orderId === null || !gatewayOrderId || !gatewayPaymentId || !signature) {
            return res.status(400).json({ error: "Incomplete payment confirmation." });
        }

        // Condition 1 of 4. This proves Razorpay issued the payment — and nothing
        // whatsoever about which of our orders it belongs to, which is why
        // markOrderPaid() re-checks the binding, the amount and the currency.
        if (!razorpay.verifyCheckoutSignature({ orderId: gatewayOrderId, paymentId: gatewayPaymentId, signature })) {
            console.error(`Checkout signature rejected for order ${orderId}, payment ${gatewayPaymentId}.`);
            return res.status(400).json({ error: "That payment confirmation could not be verified." });
        }

        try {
            const result = await markOrderPaid({
                orderId,
                gatewayPaymentId,
                gatewayOrderId,
                source: 'checkout-callback'
            });

            if (!result.ok) {
                const status = result.reason === 'gateway_unreachable' ? 503 : 409;
                return res.status(status).json({ error: result.message, reason: result.reason });
            }

            const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();

            res.status(200).json({
                paid: true,
                already: result.already || undefined,
                reference: orderReference(order),
                order_id: orderId
            });
        } catch (error) {
            console.error("Payment Verify Error:", error);
            res.status(500).json({ error: "We could not confirm that payment. If money left your account it will settle shortly." });
        }
    });

    // ---- Razorpay comes back ---------------------------------------------------
    //
    // The authority. Everything the checkout callback does, this does too, plus
    // the cases the callback never covers: the customer who closed the tab, the
    // UPI app that never came back, the payment that failed after the modal shut.
    //
    // DELIBERATELY NOT RATE LIMITED, AND THAT IS NOT AN OVERSIGHT.
    //
    // Razorpay retries until it gets a 2xx. A 429 is not a 2xx, so a limiter here
    // converts a burst of legitimate deliveries into a queue of failures and,
    // eventually, into orders that were paid for and never marked. The protection
    // is the signature: an unsigned or wrongly-signed request costs one HMAC and
    // is refused in constant time.
    router.post('/api/webhooks/razorpay', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');

        if (!PAYMENTS_ENABLED) return res.status(404).json({ error: "Not found." });

        const signature = req.get('x-razorpay-signature') || '';
        const eventId = req.get('x-razorpay-event-id') || '';
        const verified = razorpay.verifyWebhookSignature(req.rawBody, signature);

        const body = req.body || {};
        const eventType = trimmed(body.event) || 'unknown';
        const entities = body.payload || {};
        const paymentEntity = (entities.payment && entities.payment.entity) || null;
        const refundEntity = (entities.refund && entities.refund.entity) || null;
        const orderEntity = (entities.order && entities.order.entity) || null;

        // ---- 1. Record it before interpreting it.
        //
        // A handler that verifies, acts and returns 200 has destroyed its own
        // evidence. When a customer says they paid and the order says otherwise,
        // the question is what Razorpay actually sent — and that answer has to
        // survive the processing failing. So the append happens first, including
        // for deliveries that fail verification: those rows are the only
        // visibility into someone probing this endpoint.
        let eventRow = null;
        try {
            const inserted = await supabase.from('payment_events').insert([{
                // Razorpay's own id where it sent one. The fallback satisfies NOT
                // NULL for a malformed delivery without inventing something that
                // could collide with a real id.
                event_id: eventId || `unsigned:${crypto.randomUUID()}`,
                event_type: eventType,
                gateway: 'razorpay',
                gateway_order_id: (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id) || null,
                gateway_payment_id: (paymentEntity && paymentEntity.id) || (refundEntity && refundEntity.payment_id) || null,
                order_id: null,
                payload: body,
                signature_verified: verified
            }]).select().single();

            if (inserted.error) throw inserted.error;
            eventRow = inserted.data;
        } catch (error) {
            // 23505 on event_id is the unique index (migration 014 §8) saying this
            // exact delivery has been seen. That is a redelivery, and the correct
            // answer is 200 — anything else asks Razorpay to send it again.
            if (error && error.code === '23505') {
                return res.status(200).json({ received: true, duplicate: true });
            }
            console.error("Webhook Store Error:", error);
            // 500 so Razorpay retries: the event is not safely recorded.
            return res.status(500).json({ error: "Could not record the event." });
        }

        // ---- 2. Only now, is it genuine?
        if (!verified) {
            console.error(`Razorpay webhook signature rejected (event ${eventId || 'no id'}, type ${eventType}).`);
            return res.status(400).json({ error: "Invalid signature." });
        }

        const finish = async (note) => {
            await supabase.from('payment_events')
                .update({ processed_at: new Date().toISOString(), process_error: note || null })
                .eq('id', eventRow.id);
        };

        // ---- 3. Act on it.
        try {
            // Our order id rides in the notes set when the gateway order was
            // created. Falling back to a lookup by gateway_order_id covers an
            // event whose notes did not survive.
            const notes = (paymentEntity && paymentEntity.notes) || (orderEntity && orderEntity.notes) || {};
            const gatewayOrderId = (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id) || null;
            let orderId = optionalId(notes.order_id);

            if (orderId === null && gatewayOrderId) {
                const { data } = await supabase.from('payments').select('order_id').eq('gateway_order_id', gatewayOrderId).maybeSingle();
                if (data) orderId = data.order_id;
            }

            if (orderId !== null) {
                // NOT SWALLOWED. This call's result was discarded, and it failed
                // on every delivery for as long as the route existed: 014 made
                // payment_events append-only with a per-COLUMN update grant and
                // `order_id` was not among the columns, so PostgREST answered
                // 42501 every time. Nothing logged it, so the only symptom was an
                // audit trail that could not be joined to the orders it described.
                // Migration 019 adds the grant; this is what will say so if the
                // grant is ever missing again.
                //
                // Logged, not thrown: the delivery has been recorded and acted on
                // by the time this runs, and failing the request would ask
                // Razorpay to redeliver an event that was already handled.
                const { error: linkError } = await supabase
                    .from('payment_events')
                    .update({ order_id: orderId })
                    .eq('id', eventRow.id);

                if (linkError) {
                    console.error(
                        `Webhook: could not link event ${eventRow.id} to order ${orderId} — ` +
                        `the delivery was processed but the audit row stays unlinked.`,
                        linkError
                    );
                }
            }

            if (eventType === 'payment.captured' || eventType === 'order.paid') {
                if (orderId === null || !paymentEntity) {
                    await finish('no order could be resolved from this event');
                } else {
                    const result = await markOrderPaid({
                        orderId,
                        gatewayPaymentId: paymentEntity.id,
                        gatewayOrderId: gatewayOrderId,
                        source: `webhook:${eventType}`
                    });
                    await finish(result.ok ? null : result.reason);
                }
            } else if (eventType === 'payment.failed') {
                if (orderId !== null && paymentEntity) {
                    const row = await gatewayPaymentRow(orderId);
                    // Never downgrade a Paid row: a failed attempt can legitimately
                    // arrive after a successful retry on the same order.
                    if (row && row.status !== PAYMENT_STATUS.paid) {
                        await supabase.from('payments')
                            .update({ status: PAYMENT_STATUS.failed, transaction_id: paymentEntity.id })
                            .eq('id', row.id);
                    }
                }
                await finish(null);
            } else if (eventType === 'refund.processed') {
                // Recorded, never initiated here. There is no browser-reachable
                // refund path in this codebase and there must not be one — a refund
                // is an action taken in the Razorpay dashboard, and this event is
                // how the ledger learns it happened.
                if (orderId !== null && refundEntity) {
                    const row = await gatewayPaymentRow(orderId);
                    if (row) {
                        const full = Number(refundEntity.amount) >= Number(row.amount_paise);
                        await supabase.from('payments')
                            .update({ status: full ? 'Refunded' : 'Partially Refunded' })
                            .eq('id', row.id);
                    }
                }
                await finish(null);
            } else {
                // Subscribed to something this does not act on. Recorded and
                // acknowledged rather than retried forever.
                await finish('event type not handled');
            }

            res.status(200).json({ received: true });
        } catch (error) {
            console.error("Webhook Processing Error:", error);
            try { await finish(String(error && error.message).slice(0, 500)); } catch (ignored) {}
            // The event is stored, so this can be replayed from payment_events —
            // but a 500 asks for Razorpay's retry too, which is the cheaper
            // recovery of the two.
            res.status(500).json({ error: "Could not process the event." });
        }
    });

    return router;
}

module.exports = { paymentsController };
