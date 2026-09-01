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

// A rounded rupee amount (2dp, as round2() produces) to an EXACT integer of
// paise, as a BigInt. Everything past this point is integer arithmetic —
// which is what makes allocatePaise() below exact rather than approximate.
const toPaiseBig = (rupees) => BigInt(Math.round((Number(rupees || 0) + Number.EPSILON) * 100));

// The inverse, back to rupees — for display and for the double-precision
// money columns the rest of this codebase already stores amounts in.
const fromPaiseBig = (paise) => Number(paise) / 100;

// Largest-remainder allocation of an integer `total` (BigInt paise) across
// `weights` (BigInt paise), in proportion to each weight, such that the
// shares sum to EXACTLY `total` — never one paise more or less.
//
// Built for order-invoice.service.js, which used to round each invoice
// line's tax independently and dump whatever was left over onto shipping.
// That could and did produce negative shipping GST on a zero-shipping order,
// and line totals that did not sum to the invoice total. Rounding a frozen
// header figure has to happen ONCE, not once per line — this is that one
// rounding, done in integer paise so it cannot drift, with the leftover
// paise (there is always at most `weights.length - 1` of them, from
// truncating each proportional share down) handed to the weights with the
// largest truncated remainder first.
//
// `total` with an all-zero `weights` is only valid when `total` is also
// zero (nothing taxable, no tax) — a nonzero total against zero taxable
// weight is a contradiction (tax charged against nothing) and is refused
// rather than silently producing an invoice that says so.
function allocatePaise(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0n);
    if (sum === 0n) {
        if (total !== 0n) throw new Error('Tax charged against zero taxable value.');
        return weights.map(() => 0n);
    }

    const shares = weights.map((w) => (total * w) / sum);
    const ranked = weights
        .map((w, i) => ({ i, remainder: (total * w) % sum }))
        .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.i - b.i));

    let left = total - shares.reduce((a, b) => a + b, 0n);
    for (let j = 0; left > 0n; j++, left--) {
        shares[ranked[j].i] += 1n;
    }
    return shares;
}

module.exports = { priceNumber, round2, toPaiseBig, fromPaiseBig, allocatePaise };
