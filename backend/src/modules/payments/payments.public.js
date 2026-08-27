/*
 * modules/payments/payments.public.js - what siblings may hold
 * ============================================================================
 *
 * ONE READ PORT, ONE CALLER. modules/orders needs the payment row behind an
 * order twice: to decide whether to hand the customer a "pay now" handshake in
 * their order history, and to refuse a cancel on an order that has a gateway
 * payment against it.
 *
 * markOrderPaid IS NOT PUBLISHED, deliberately. It is the only writer of
 * 'Paid' in the application, both of its callers are in this module, and a
 * third caller should be a route here rather than a sibling reaching in. The
 * comment on gatewayPaymentRow explains the same instinct one level down: the
 * lookup takes an order id ALONE, because filtering on the presented gateway
 * order id as well would silently disable the replay check.
 */
const { gatewayPaymentRow } = require('./services/settle-payment.service');

module.exports = { gatewayPaymentRow };
