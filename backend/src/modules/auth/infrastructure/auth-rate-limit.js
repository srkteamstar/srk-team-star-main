/*
 * modules/auth/infrastructure/auth-rate-limit.js
 * ============================================================================
 *
 * ONE INSTANCE SHARED BY BOTH DOORS, which is the opposite call to the one
 * that split the enquiry and quote limiters - and deliberately so. There, two
 * budgets served two different honest users. Here, a separate budget for the
 * second door would only hand an attacker twice as many attempts at the same
 * user_profiles table.
 */
const rateLimit = require('express-rate-limit');

// Authentication is credentialed, but rate limiting still bounds guessing and
// account enumeration. Tighter than the form limiter, not looser.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many attempts. Try again in a few minutes." }
});

module.exports = { authLimiter };
