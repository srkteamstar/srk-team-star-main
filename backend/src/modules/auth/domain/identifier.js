/*
 * modules/auth/domain/identifier.js - what a customer signs in with
 * ============================================================================
 *
 * ONE FIELD, TWO KINDS OF VALUE. The storefront door takes an email address or
 * a phone number and works out which it was handed. That is a domain rule, not
 * a validation helper: it decides which column the lookup runs against.
 *
 * phone_normalized (migration 011) is the reason a phone works at all. The
 * column user_profiles.phone_number was int8, which cannot hold a leading
 * zero, a space or a +91 - and phone is one of the two things you sign in
 * with, so that was load-bearing rather than cosmetic. Digits-only
 * normalisation is what makes "+91 89015 03544", "089015 03544" and
 * "8901503544" one account.
 */
const { trimmed } = require('../../../shared/validation');

function normalizePhone(value) {
    const digits = String(value === null || value === undefined ? '' : value).replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length === 12 && digits.slice(0, 2) === '91') return digits.slice(2);
    if (digits.length === 11 && digits.slice(0, 1) === '0') return digits.slice(1);
    return digits;
}

// Stored lowercase so `.eq('email', ...)` is an exact, index-backed match.
// PostgREST's ilike would be the alternative and is wrong here: it reads _
// and % as wildcards, and both are legal in a local part.
const normalizeEmail = (value) => trimmed(value).toLowerCase();

const looksLikeEmail = (value) => value.indexOf('@') !== -1;

module.exports = { normalizePhone, normalizeEmail, looksLikeEmail };
