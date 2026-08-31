/*
 * modules/orders/infrastructure/order-rate-limit.js
 * ============================================================================
 */
const { storefrontRateLimit } = require('../../../core/http/rate-limit');

// through fulfilment, and giving it its own single-purpose route means there
// is no body to whitelist and no way to ask for a status it should not reach.
// A Processing, Shipped or Delivered order is refused here by name: cancelling
// something already being fulfilled is a conversation, not a button.
const orderCancelLimiter = storefrontRateLimit('order-cancel', {
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: "Too many attempts. Try again in a few minutes." }
});

// A checkout tab polls this every few seconds while an order is unpaid — a
// customer taking the full five-minute bounded wait (checkout-module.js) at
// the fastest cadence is still well under 150 requests. Generous on purpose:
// the client-side poller is already bounded (backoff, one in-flight request,
// a hard stop after five minutes), so this limiter exists for abuse, not for
// the ordinary case.
const orderStatusLimiter = storefrontRateLimit('order-status', {
    windowMs: 15 * 60 * 1000,
    max: 240,
    message: { error: "Too many status checks. Try again in a few minutes." }
});

module.exports = { orderCancelLimiter, orderStatusLimiter };
