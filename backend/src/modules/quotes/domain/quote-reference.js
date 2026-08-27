/*
 * modules/quotes/domain/quote-reference.js — the number a customer reads back
 * ============================================================================
 */
// Matches the reference number the overlay shows on its confirmation screen and
// the id the dashboard prints on the row, so the number a customer quotes back
// is the row staff will actually find. Derived from created_at, not from "now",
// so an old row reads the same next year as it did the day it arrived.
//
// Prefixed PI- (proforma invoice, the standard B2B term for a priced pre-order
// document), not QT-. request-quote-module.js's referenceFor() fallback and
// quotations.js's own fallback both carry the same prefix — all three must
// agree, since this is the number a customer reads back to staff.
function quoteReference(id, createdAt) {
    if (id === null || id === undefined) return '';
    const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
    return `PI-${year}-${String(id).padStart(4, '0')}`;
}

module.exports = { quoteReference };
