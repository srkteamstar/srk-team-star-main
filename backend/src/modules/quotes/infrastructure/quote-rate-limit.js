/*
 * modules/quotes/infrastructure/quote-rate-limit.js
 * ============================================================================
 *
 * SEPARATE FROM THE ENQUIRY FORM'S LIMITER, and that is the whole reason this
 * file exists rather than a shared one. express-rate-limit keeps ONE COUNTER
 * PER IP per instance, so a single instance covering both routes meant five
 * contact-form submissions spent the quote form's allowance too, and a visitor
 * who did both hit a wall that named neither.
 */
const { storefrontRateLimit } = require('../../../core/http/rate-limit');

const quoteLimiter = storefrontRateLimit('quote-create', {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: "Too many quote requests from this IP, please try again later." }
});

// Live calculation is deliberately a different bucket. A visitor editing two
// quantities should not spend the five-attempt allowance that protects the
// database write, and the 350ms browser debounce is not a security boundary.
const quoteCalculationLimiter = storefrontRateLimit('quote-calculate', {
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: { error: "Too many quote calculations from this IP, please pause and try again." }
});

module.exports = { quoteLimiter, quoteCalculationLimiter };
