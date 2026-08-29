/*
 * modules/checkout/infrastructure/checkout-rate-limit.js
 * ============================================================================
 */
const { storefrontRateLimit } = require('../../../core/http/rate-limit');

// Two limiters, not one shared instance. An express-rate-limit instance keeps
// a single counter per IP, so using one for both routes meant that merely
// *looking* at the checkout page spent the budget for actually ordering:
// /api/checkout/summary runs on every page load and again after removing each
// unavailable line, so a customer tidying a few blocked items could be locked
// out of placing the order they had just fixed.
//
// Pricing is a read and is cheap; placing an order writes five rows.
const summaryLimiter = storefrontRateLimit('checkout-summary', {
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: "Too many requests. Try again in a few minutes." }
});

const checkoutLimiter = storefrontRateLimit('checkout-create', {
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: "Too many checkout attempts. Try again in a few minutes." }
});

module.exports = { summaryLimiter, checkoutLimiter };
