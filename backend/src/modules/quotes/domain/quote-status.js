/*
 * modules/quotes/domain/quote-status.js — the vocabulary and the ceiling
 * ============================================================================
 *
 * ==========================================
 * The store's Request a Quote overlay used to post through /api/submit-form as
 * form_type 'quote', which filed it in `enquiries` with the address, the
 * itemised products and the notes flattened into one free-text column. A quote
 * carries a repeating list, which prose cannot represent and nothing downstream
 * can query, so it now has its own tables — see
 * backend/migrations/009_quote_requests.sql for the full reasoning.
 */
const QUOTE_STATUSES = ['Open', 'In Progress', 'Resolved'];

// The overlay's "+ Add Another Product" is unbounded in the UI, which is right
// for a customer with a long list and wrong for an endpoint taking anonymous
// input. A ceiling, not a rule anyone will meet by accident.
const QUOTE_MAX_ITEMS = 50;

module.exports = { QUOTE_STATUSES, QUOTE_MAX_ITEMS };
