/*
 * modules/orders/controllers/customer-orders.controller.js
 * ============================================================================
 *
 *   GET  /api/orders/mine        requireCustomer, filtered on req.profile.id
 *   POST /api/orders/:id/cancel  requireCustomer, exactly one status edge
 *
 * THE HANDSHAKE COMES BACK WITH THE ORDER. `payment` is present only on an
 * order still awaiting money through the gateway, and it is what makes an
 * unpaid order resumable after a reload instead of a dead end that
 * manufactures duplicate orders. Nothing in it is new information: key_id is
 * public by design and gateway_order_id was already sent to this same browser
 * by POST /api/checkout.
 *
 * can_cancel IS COMPUTED SERVER-SIDE rather than re-derived from the status
 * string in the browser - the same reasoning that makes payment-module.js's
 * "settling" a structured flag instead of a phrase matched out of prose.
 *
 * THE CANCEL ASKS RAZORPAY BEFORE IT WRITES, and an unreachable gateway is a
 * REFUSAL. Our own payments row is only as current as the last delivery we
 * processed, and a customer can be standing in the modal in a second tab while
 * pressing Cancel in this one. Fail-closed costs a minute; fail-open cancels
 * an order that was just paid for.
 *
 * THE ORIGINAL SECTION HEADER
 *
 *
 * The customer-scoped half of GET /api/orders. Deliberately its own query
 * rather than a filter over fetchOrderRows(): that one reads every order in
 * the system before narrowing, which is wrong on a route any signed-in
 * visitor can call.
 *
 * The shape is my-orders-module.js's sample shape, which was written to be
 * what these tables would want — an ISO placed_at, real line items with unit
 * prices and quantities, and no money not derived from them.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const razorpay = require('../../../core/gateways/razorpay');
const { requireCustomer } = require('../../../core/security/guards');
const { PAYMENTS_ENABLED } = require('../../../core/config/payments');
const { optionalId } = require('../../../shared/validation');
const { CURRENCY, PAYMENT_STATUS } = require('../../../shared/contracts/payment');
const { ORDER_STATUS_AWAITING_PAYMENT } = require('../../../shared/contracts/order-status');
const { orderReference } = require('../../../shared/contracts/order-reference');
const { gatewayPaymentRow } = require('../../payments/payments.public');
const { orderCancelLimiter, orderStatusLimiter } = require('../infrastructure/order-rate-limit');
const { buildOrderInvoice } = require('../services/order-invoice.service');
const { accessibleOrder } = require('../services/order-access.service');

// THE HANDSHAKE-AND-CAN-CANCEL RULE, IN ONE PLACE.
//
// Shared between /api/orders/mine (one customer's whole history) and
// GET /api/orders/:id/status (one order, session OR guest token) so the two
// routes cannot drift into publishing a Pay-now handshake under different
// conditions. See the long comment this used to carry inline in
// /api/orders/mine for why each of the four handshake conditions exists.
function orderStatusView(order, payment) {
    return {
        payment: (
            PAYMENTS_ENABLED &&
            order.status === ORDER_STATUS_AWAITING_PAYMENT &&
            payment &&
            payment.gateway === 'razorpay' &&
            payment.status !== PAYMENT_STATUS.paid &&
            payment.gateway_order_id
        ) ? {
            key_id: razorpay.publicKeyId(),
            gateway_order_id: payment.gateway_order_id,
            amount_paise: payment.amount_paise,
            currency: payment.currency || CURRENCY
        } : undefined,

        can_cancel: Boolean(
            order.status === ORDER_STATUS_AWAITING_PAYMENT &&
            (!payment || payment.status !== PAYMENT_STATUS.paid)
        )
    };
}

/** @returns {import('express').Router} */
function customerOrdersController() {
    const router = express.Router();

    router.get('/api/orders/mine', requireCustomer, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('*')
                .eq('user_id', req.profile.id)
                .order('created_at', { ascending: false });

            if (ordersError) throw ordersError;
            if (!orders || orders.length === 0) return res.status(200).json([]);

            const orderIds = orders.map(o => o.id);

            const [itemsRes, shippingRes, paymentsRes] = await Promise.all([
                supabase.from('order_items').select('*').in('order_id', orderIds),
                supabase.from('order_shipping_address').select('*').in('order_id', orderIds),
                supabase.from('payments').select('*').in('order_id', orderIds)
            ]);

            if (itemsRes.error) throw itemsRes.error;
            if (shippingRes.error) throw shippingRes.error;
            if (paymentsRes.error) throw paymentsRes.error;

            const items = itemsRes.data || [];

            // order_items stores the product name it was sold under and not its
            // category, which is right — the name is the historical record. The
            // category is only a label, so it is looked up live and simply absent
            // when the product has since been deleted.
            const productIds = [...new Set(items.map(i => i.product_id).filter(id => id !== null && id !== undefined))];

            let categoryByProduct = new Map();
            if (productIds.length) {
                const { data: products, error: productsError } = await supabase
                    .from('products').select('id, category_id').in('id', productIds);
                if (productsError) throw productsError;

                const categoryIds = [...new Set((products || []).map(p => p.category_id).filter(Boolean))];
                let nameById = new Map();

                if (categoryIds.length) {
                    const { data: categories, error: categoriesError } = await supabase
                        .from('categories').select('id, name').in('id', categoryIds);
                    if (categoriesError) throw categoriesError;
                    nameById = new Map((categories || []).map(c => [String(c.id), c.name]));
                }

                categoryByProduct = new Map((products || []).map(p =>
                    [String(p.id), nameById.get(String(p.category_id)) || null]));
            }

            const itemsByOrder = new Map();
            items.forEach(item => {
                const key = String(item.order_id);
                const list = itemsByOrder.get(key) || [];
                list.push(item);
                itemsByOrder.set(key, list);
            });

            const shippingByOrder = new Map((shippingRes.data || []).map(s => [String(s.order_id), s]));

            // An order can carry more than one payment row (a retry after a
            // failure), so the most recent describes where it actually stands.
            const paymentByOrder = new Map();
            (paymentsRes.data || []).forEach(payment => {
                const key = String(payment.order_id);
                const existing = paymentByOrder.get(key);
                if (!existing || new Date(payment.created_at) > new Date(existing.created_at)) {
                    paymentByOrder.set(key, payment);
                }
            });

            const rows = orders.map(order => {
                const shipping = shippingByOrder.get(String(order.id)) || null;
                const payment = paymentByOrder.get(String(order.id)) || null;

                // A terminal Razorpay failure is retained as an audit record
                // so a late capture can still be reconciled, but it is not a
                // placed order. If money arrives later, settlement changes the
                // order to Payment Review and the row becomes visible again.
                if (order.status === 'Cancelled' && payment && payment.status === PAYMENT_STATUS.failed) {
                    return null;
                }

                return {
                    id: order.id,
                    // One shared formatter, not a fourth copy of these two lines -
                    // see shared/contracts/order-reference.js.
                    reference: orderReference(order),
                    placed_at: order.created_at,
                    status: order.status || 'Processing',
                    payment_status: payment ? payment.status : null,
                    // How it was paid for, from the customer's own point of view:
                    // the instrument they chose for an offline order, or the one
                    // Razorpay reported for a gateway one. Null while a gateway
                    // payment is still in flight, which is honest — nobody has
                    // chosen an instrument yet at that point.
                    //
                    // Added so an order history can say "Cash on Delivery" rather
                    // than leaving the customer to infer it from a status, and so
                    // the payment-mode branch is observable from a customer
                    // session — the alternative was a privileged route, and
                    // proving a customer-facing choice through such a door is the wrong
                    // shape for a test as well as for a page.
                    payment_method: payment ? (payment.payment_method || null) : null,

                    // THE HANDSHAKE AND CANCEL RULE, from orderStatusView() above —
                    // shared with GET /api/orders/:id/status so the two routes
                    // cannot drift on when a Pay-now button is safe to offer.
                    ...orderStatusView(order, payment),

                    tracking: order.tracking || '',
                    shipping_address: shipping
                        ? [shipping.full_address, shipping.city, shipping.state, shipping.zip_code, shipping.country]
                            .filter(Boolean).join(', ')
                        : '',
                    items: (itemsByOrder.get(String(order.id)) || []).map(item => ({
                        product_id: item.product_id,
                        product_name: item.product_name,
                        category_name: item.product_id !== null && item.product_id !== undefined
                            ? categoryByProduct.get(String(item.product_id)) || null
                            : null,
                        unit_price: item.price === null || item.price === undefined ? null : String(item.price),
                        quantity: item.quantity
                    }))
                };
            }).filter(Boolean);

            res.status(200).json(rows);
        } catch (error) {
            console.error("Fetch My Orders Error:", error);
            res.status(500).json({ error: "Failed to fetch your orders." });
        }
    });

    // ---- One order, for a checkout tab to poll -----------------------------
    //
    // The whole reason this exists: a webhook settles an order on the server
    // while the browser that placed it is still sitting on the checkout page,
    // and nothing before this route ever told that page to ask again. It is
    // deliberately the smallest possible read — not the invoice, not the full
    // history — because a page polling every few seconds should not be
    // transferring a full invoice on each tick.
    //
    // Same access rule as the invoice route below: a signed-in customer's own
    // order, or a guest's one-order access token. No new authorization
    // surface — accessibleOrder() is the same boundary /api/orders/:id/invoice
    // already uses.
    router.get('/api/orders/:id/status', orderStatusLimiter, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        const orderId = optionalId(req.params.id);
        if (orderId === null) return res.status(404).json({ error: 'No such order.' });

        try {
            const access = await accessibleOrder(req, orderId);
            if (!access.order) return res.status(access.status).json({ error: access.error });
            const order = access.order;

            const payment = await gatewayPaymentRow(order.id);

            res.status(200).json({
                order_id: order.id,
                reference: orderReference(order),
                status: order.status || 'Processing',
                payment_status: payment ? payment.status : null,
                requires_review: order.status === 'Payment Review',
                ...orderStatusView(order, payment)
            });
        } catch (error) {
            console.error('Fetch Order Status Error:', error);
            res.status(500).json({ error: 'Could not check that order.' });
        }
    });

    // A formal invoice is a read of the frozen order record. Account orders use
    // the customer session; guest orders use the one-order token from checkout.
    // A mismatch always reads as 404, so ids cannot be used for discovery.
    router.get('/api/orders/:id/invoice', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        const orderId = optionalId(req.params.id);
        if (orderId === null) return res.status(404).json({ error: 'No such invoice.' });

        try {
            const access = await accessibleOrder(req, orderId);
            if (!access.order) return res.status(access.status).json({ error: access.error });
            const order = access.order;

            const [itemsRes, shippingRes, payment] = await Promise.all([
                supabase.from('order_items').select('*').eq('order_id', order.id).order('id', { ascending: true }),
                supabase.from('order_shipping_address').select('*').eq('order_id', order.id).maybeSingle(),
                gatewayPaymentRow(order.id)
            ]);

            if (itemsRes.error) throw itemsRes.error;
            if (shippingRes.error) throw shippingRes.error;

            res.status(200).json(buildOrderInvoice({
                order,
                items: itemsRes.data || [],
                shipping: shippingRes.data || null,
                payment
            }));
        } catch (error) {
            console.error('Fetch Customer Invoice Error:', error);
            res.status(500).json({ error: 'Failed to load that invoice.' });
        }
    });

    // ---- The customer's own way out of an unpaid order --------------------------
    //
    // Until this existed, a customer who abandoned a payment had exactly one
    // option: place the order again. The first one stayed 'Pending Payment'
    // forever, holding an order_number, looking live on every report, and
    // waiting for money nobody was going to send.
    //
    // THIS IS THE ONLY CUSTOMER-REACHABLE WRITE TO orders.status, AND IT MOVES
    // EXACTLY ONE EDGE: 'Pending Payment' -> 'Cancelled'.
    //
    // Not a general status route with a validated vocabulary — fulfilment is
    // not this application's job. A customer cancelling their own unpaid order
    // is a different act from somebody moving an order

    router.post('/api/orders/:id/cancel', orderCancelLimiter, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        const orderId = optionalId(req.params.id);
        if (orderId === null) return res.status(404).json({ error: "No such order." });

        try {
            const failedCheckout = Boolean(req.body && req.body.reason === 'payment_failed');
            const access = await accessibleOrder(req, orderId);
            if (!access.order) return res.status(access.status).json({ error: access.error });
            const order = access.order;

            // Idempotent. A double-click, or a retry after a dropped response,
            // should not read as a failure for work that is already done. A
            // failed-checkout retry continues below so it can finish marking
            // the payment if the process stopped after cancelling the order.
            if (order.status === 'Cancelled' && !failedCheckout) {
                return res.status(200).json({ cancelled: true, already: true, order_id: order.id });
            }

            if (order.status !== ORDER_STATUS_AWAITING_PAYMENT && !(failedCheckout && order.status === 'Cancelled')) {
                return res.status(409).json({
                    error: "This order is already being processed, so it cannot be cancelled here. Get in touch and we will sort it out."
                });
            }

            const payment = await gatewayPaymentRow(order.id);

            if (payment && payment.status === PAYMENT_STATUS.paid) {
                return res.status(409).json({
                    error: "This order has been paid for, so it cannot be cancelled here. Get in touch and we will sort it out."
                });
            }

            // Only a Razorpay attempt can be classified as a failed checkout.
            // A browser cannot use this flag to hide an offline order or one
            // whose payment state has moved beyond Created/Failed.
            if (failedCheckout && (
                !payment ||
                payment.gateway !== 'razorpay' ||
                ![PAYMENT_STATUS.created, PAYMENT_STATUS.failed].includes(payment.status)
            )) {
                return res.status(409).json({
                    error: "This payment attempt cannot be classified as failed. Refresh to see where it stands."
                });
            }

            // ---- THE RACE THIS ROUTE HAS TO LOSE SAFELY.
            //
            // Our own payments row says nobody has paid. That row is only as
            // current as the last webhook or callback we processed, and a customer
            // can perfectly well be standing in the Razorpay modal in a second tab
            // while pressing Cancel in this one. Believing our own row would
            // cancel an order that is being paid for at that moment — and
            // markOrderPaid()'s order update is guarded on the awaiting-payment
            // status precisely so it cannot resurrect a cancelled order, so the
            // money would land against a Cancelled row and stay there.
            //
            // So the gateway is asked, over the same connection markOrderPaid()
            // uses and the customer cannot touch. `amount_paid` is the honest
            // question: an order Razorpay has taken any money against is not one
            // this route may close.
            //
            // UNREACHABLE IS A REFUSAL, NOT A PASS. Fail-closed is cheap here —
            // the order stays cancellable a minute later — and fail-open means
            // cancelling an order that may have just been paid for.
            if (PAYMENTS_ENABLED && payment && payment.gateway === 'razorpay' && payment.gateway_order_id) {
                let gatewayOrder;
                try {
                    gatewayOrder = await razorpay.fetchOrder(payment.gateway_order_id);
                } catch (gatewayError) {
                    console.error('Cancel refused — could not reach Razorpay for order', order.id, gatewayError.message);
                    return res.status(503).json({
                        error: "We could not reach the payment provider to check this order. Please try again in a moment."
                    });
                }

                if (gatewayOrder && (Number(gatewayOrder.amount_paid) > 0 || gatewayOrder.status === 'paid')) {
                    console.warn(`Cancel refused: order ${order.id} has ${gatewayOrder.amount_paid} paise paid at the gateway.`);
                    return res.status(409).json({
                        error: "A payment has been received against this order, so it cannot be cancelled. It will appear as paid shortly."
                    });
                }
            }

            // Guarded on the status a second time, in the WHERE clause rather than
            // in JavaScript. Everything above took time — a webhook may have
            // landed during the round trip to Razorpay — and this is the only
            // check that is atomic with the write.
            if (order.status !== 'Cancelled') {
                const { data: updated, error: updateError } = await supabase
                    .from('orders')
                    .update({ status: 'Cancelled' })
                    .eq('id', order.id)
                    .eq('status', ORDER_STATUS_AWAITING_PAYMENT)
                    .select()
                    .maybeSingle();

                if (updateError) throw updateError;

                if (!updated) {
                    // Somebody else moved it while we were asking. Almost certainly
                    // markOrderPaid(), which is the good outcome — say so rather than
                    // reporting a failure for an order that just got paid for.
                    return res.status(409).json({
                        error: "This order changed while we were cancelling it. Refresh to see where it stands."
                    });
                }
            }

            if (failedCheckout && payment.status === PAYMENT_STATUS.created) {
                // The order was cancelled first. If a captured-payment webhook
                // won the race, this guarded update touches nothing and we
                // refuse to call the attempt failed. Settlement will expose it
                // as Payment Review instead.
                const { data: failedPayment, error: paymentUpdateError } = await supabase
                    .from('payments')
                    .update({ status: PAYMENT_STATUS.failed })
                    .eq('id', payment.id)
                    .eq('status', PAYMENT_STATUS.created)
                    .select()
                    .maybeSingle();

                if (paymentUpdateError) throw paymentUpdateError;
                if (!failedPayment) {
                    const latestPayment = await gatewayPaymentRow(order.id);
                    if (latestPayment && latestPayment.status === PAYMENT_STATUS.failed) {
                        console.log(`Failed checkout attempt ${order.id} was already marked failed by the gateway webhook.`);
                        return res.status(200).json({ cancelled: true, discarded: true, order_id: order.id });
                    }
                    return res.status(409).json({
                        error: "This payment changed while we were closing it. Refresh to see where it stands."
                    });
                }
            }

            if (failedCheckout) {
                console.log(`Failed checkout attempt ${order.id} closed with no payment received.`);
                return res.status(200).json({ cancelled: true, discarded: true, order_id: order.id });
            }

            // A voluntary cancellation leaves the payment at Created. That is
            // what happened: a gateway order existed but no attempt failed.
            console.log(`Order ${order.id} cancelled by the customer before payment.`);
            res.status(200).json({ cancelled: true, order_id: order.id });
        } catch (error) {
            console.error("Cancel Order Error:", error);
            res.status(500).json({ error: "Could not cancel that order." });
        }
    });

    return router;
}

module.exports = { customerOrdersController };
