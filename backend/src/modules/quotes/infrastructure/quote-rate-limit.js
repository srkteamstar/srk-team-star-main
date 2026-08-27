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
const rateLimit = require('express-rate-limit');

const quoteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: "Too many quote requests from this IP, please try again later." }
});

module.exports = { quoteLimiter };
