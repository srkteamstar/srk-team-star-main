/*
 * modules/auth/infrastructure/auth-rate-limit.js
 * ============================================================================
 *
 * ONE INSTANCE SHARED BY BOTH DOORS, which is the opposite call to the one
 * that split the enquiry and quote limiters - and deliberately so. There, two
 * budgets served two different honest users. Here, a separate budget for the
 * second door would only hand an attacker twice as many attempts at the same
 * user_profiles table.
 *
 * S05: authLimiter alone bounds attempts per IP, and only per IP. An attacker
 * spreading a password-guessing run across many addresses never trips it,
 * while every attempt still lands on the same account. accountLoginLimiter is
 * a second, independent budget keyed to the ACCOUNT being attempted rather
 * than the caller, so that gap closes without opening a new one:
 *
 *   - the key is an HMAC of the normalized identifier, never the identifier
 *     itself, so a raw email or phone number never sits in the limiter's
 *     store or logs;
 *   - the budget is the same kind of sliding window authLimiter already
 *     uses. It always expires on its own. Nothing here can turn it into a
 *     flag on the account row, because a caller who knows nothing but a
 *     stranger's email must not be able to lock that stranger out
 *     indefinitely — that would trade one abuse for a worse one.
 */
const crypto = require('crypto');
const { storefrontRateLimit } = require('../../../core/http/rate-limit');
const { trimmed } = require('../../../shared/validation');
const { normalizePhone, normalizeEmail, looksLikeEmail } = require('../domain/identifier');

// Authentication is credentialed, but rate limiting still bounds guessing and
// account enumeration. Tighter than the form limiter, not looser.
const authLimiter = storefrontRateLimit('auth', {
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many attempts. Try again in a few minutes." }
});

// core/http/session.js already refuses to boot without a SESSION_SECRET of
// at least 32 characters, so this reads a value that assertion has already
// guaranteed is present by the time any request reaches here. The random
// fallback exists only so requiring this module in isolation (a script, a
// future test) cannot throw over an unrelated missing variable; it is never
// what a running server actually keys against, since the boot assertion
// refuses to let the process reach one.
const HMAC_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Same normalisation resolveIdentifier() uses to pick a column, so "the
// account this key names" and "the account the login route resolves" can
// never disagree.
function accountThrottleKey(req) {
    const identifier = trimmed(req.body && req.body.identifier);
    if (!identifier) return 'malformed';

    const normalized = looksLikeEmail(identifier) ? normalizeEmail(identifier) : normalizePhone(identifier);
    if (!normalized) return 'malformed';

    return crypto.createHmac('sha256', HMAC_SECRET).update(normalized).digest('hex');
}

const accountLoginLimiter = storefrontRateLimit('auth-account', {
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyGenerator: accountThrottleKey,
    message: { error: "Too many attempts on this account. Try again in a few minutes." }
});

module.exports = { authLimiter, accountLoginLimiter, accountThrottleKey };
