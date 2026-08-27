/*
 * shared/money.js — reading a price, and keeping a total honest
 * ============================================================================
 *
 * `products.price` is a TEXT column and "On request" is a legal value in it —
 * 43 of 48 rows today — so turning one into a number is a decision with a
 * "no" in it, not a cast. Every surface that totals anything goes through
 * here: modules/checkout prices an order with it, and the browser's
 * price-format-module.js implements the identical rule on its side.
 *
 * The two must agree character for character or the cart and the invoice will
 * disagree, which is the one class of bug in this application a customer would
 * be right to be angry about.
 */
// products.price is a text column, so "On request" is a legal value. This is
// price-format-module.js's numericValue rule, character for character —
// commas tolerated, anything else is not a number. The two must agree or the
// cart and the invoice will disagree.
function priceNumber(value) {
    if (value === null || value === undefined) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    const numeric = raw.replace(/,/g, '');
    if (!/^[0-9]+([.][0-9]+)?$/.test(numeric)) return null;

    const amount = Number(numeric);
    return Number.isFinite(amount) ? amount : null;
}

// Money, to paise. Floating point cannot hold 0.1, and an order total that is
// out by 1e-13 will eventually print as a rupee off.
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

module.exports = { priceNumber, round2 };
