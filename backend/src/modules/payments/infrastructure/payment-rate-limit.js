/*
 * modules/payments/infrastructure/payment-rate-limit.js
 * ============================================================================
 *
 * THE WEBHOOK IS DELIBERATELY NOT RATE LIMITED and has no limiter here.
 * Razorpay retries until it gets a 2xx, and a 429 is not a 2xx - so a limiter
 * on that route would turn a burst of legitimate deliveries into orders that
 * were paid for and never marked. The signature is the protection, and it
 * costs one HMAC.
 */
const { storefrontRateLimit } = require('../../../core/http/rate-limit');


// A read the checkout page makes once per attempt, plus retries. Not a write,
// so it is budgeted like summaryLimiter rather than checkoutLimiter.
const verifyLimiter = storefrontRateLimit('payment-verify', {
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: "Too many verification attempts. Try again in a few minutes." }
});

module.exports = { verifyLimiter };
