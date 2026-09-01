/*
 * shared/keyset-cursor.js
 * ============================================================================
 *
 * Opaque position markers for (column, id) keyset pagination — "resume after
 * this row" rather than "skip N rows" — so a page fetched while new rows are
 * still arriving never re-shows or drops one the way an OFFSET does.
 *
 * UNSIGNED, ON PURPOSE — unlike order-access-token.js's token. That one is a
 * capability: proof of the right to read an order an anonymous request
 * carries no session for, so a forged value has to be rejected outright. A
 * cursor here only ever resumes a query the caller already scoped with its
 * own filter (GET /api/orders/mine applies .eq('user_id', req.profile.id)
 * before the cursor is ever considered), so a tampered cursor can reposition
 * a customer within their own rows and nothing else — there is no boundary
 * for it to cross. Base64url keeps it opaque and safe to hand back in a
 * header or a query string; nothing about it needs to be unguessable.
 *
 * A cursor that fails to decode is treated as "start from the top" rather
 * than a 400 — the same fail-soft the guest order-access token does NOT get,
 * because that one guards a real boundary and this one does not.
 */

function encodeCursor(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(raw) {
    if (typeof raw !== 'string' || !raw) return null;

    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (error) {
        return null;
    }
}

module.exports = { encodeCursor, decodeCursor };
