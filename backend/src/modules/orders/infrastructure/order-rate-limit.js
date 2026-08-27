/*
 * modules/orders/infrastructure/order-rate-limit.js
 * ============================================================================
 */
const rateLimit = require('express-rate-limit');

// through fulfilment, and giving it its own single-purpose route means there
// is no body to whitelist and no way to ask for a status it should not reach.
// A Processing, Shipped or Delivered order is refused here by name: cancelling
// something already being fulfilled is a conversation, not a button.
const orderCancelLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: "Too many attempts. Try again in a few minutes." }
});

module.exports = { orderCancelLimiter };
