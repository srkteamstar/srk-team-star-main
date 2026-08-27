/*
 * modules/enquiries/infrastructure/enquiry-rate-limit.js
 * ============================================================================
 *
 * ONE LIMITER PER ROUTE, NEVER ONE SHARED INSTANCE — which is why this lives
 * with the module that owns the route rather than in a core file listing every
 * limiter in the application. A shared file is how two routes end up sharing a
 * counter by accident; a limiter next to its own route cannot.
 *
 * Per-route instances for the same reason the checkout pair is split: one
 * shared instance is one shared counter, so five contact-form submissions used
 * up the quote form's budget too, and a visitor who did both hit a wall that
 * named neither.
 */
const rateLimit = require('express-rate-limit');

const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: "Too many requests from this IP, please try again later." }
});

module.exports = { formLimiter };
