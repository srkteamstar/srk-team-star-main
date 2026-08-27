/*
 * shared/validation.js — the bounds every anonymous write is held to
 * ============================================================================
 *
 * Genuinely shared: modules/enquiries, modules/quotes, modules/auth,
 * modules/checkout and modules/cart all measure the same fields against the
 * same ceilings, and the one time this was NOT shared — `/api/submit-form`
 * validating neither length nor email format while the quote and auth routes
 * did — was a real hole rather than an inconsistency. An anonymous caller set
 * the size of every text column in the row, and staff could be handed an
 * enquiry with no reachable address on it.
 *
 * Nothing here imports a module, and nothing here knows a table name. That is
 * what makes it shared rather than a domain service wearing a utility's hat.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// FIELD CEILINGS
//
// The 64kb body limit bounds one request; it does not bound one *column*. A
// single anonymous submission could put 60kb of text into enquirer_name and
// the only thing that noticed was the row. These are the sizes a real answer
// actually takes, so an over-long field is a mistake or an abuse in every
// case, and saying which field is too long is more use than a generic 400.
const MAX_LENGTHS = {
    name: 120,
    company: 160,
    email: 254,          // the RFC 5321 maximum for a whole address
    phone: 32,
    address: 400,
    message: 5000,
    notes: 5000,
    product_name: 200,
    category_name: 160
};

// Returns an error string, or null when the value fits.
function tooLong(label, value, limit) {
    if (typeof value === 'string' && value.length > limit) {
        return `${label} is too long (maximum ${limit} characters).`;
    }
    return null;
}

// Ids arrive as numbers from the API but as strings once they have been through
// an <option value>, and a category or product that no longer exists is legally
// absent — so anything unparseable becomes null rather than an error. The row
// still carries the name, which is the part staff read.
const optionalId = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const optionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

module.exports = { EMAIL_PATTERN, trimmed, MAX_LENGTHS, tooLong, optionalId, optionalNumber };
