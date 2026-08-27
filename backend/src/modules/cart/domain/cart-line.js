/*
 * modules/cart/domain/cart-line.js - what a line is, coming in and going out
 * ============================================================================
 *
 * publicCartItem is the response DTO and readCartItems is the inbound one, and
 * keeping them in the same file is the point: they describe the two ends of
 * one shape, and the row shape the browser speaks is deliberately identical to
 * the line shape cart-module.js already holds.
 *
 * THE CEILINGS HERE TRUNCATE RATHER THAN REFUSE, which is the opposite of what
 * shared/validation.js does with MAX_LENGTHS - and deliberately so. Those bound
 * text a stranger typed, where over-long is a mistake or an abuse. These bound
 * a copy of our own catalogue row, which the client re-resolves against the
 * live product on every paint anyway. Refusing a whole cart because one of our
 * own product names is long would be failing a customer over our data entry.
 */
const { cut } = require('../../../shared/text');
const { optionalId } = require('../../../shared/validation');
const { MAX_LINE_QUANTITY, MAX_CHECKOUT_LINES } = require('../../../core/config/commercial');

// is the opposite of what the anonymous write routes do with MAX_LENGTHS —
// and deliberately so. Those bound text a stranger typed, where over-long is
// a mistake or an abuse. These bound a copy of our own catalogue row, which
// the client re-resolves against the live product on every paint anyway, so
// the stored value is a fallback for a product that has since disappeared.
// Refusing the whole cart because one of our own product names is long would
// be failing a customer over our data entry.
const CART_SNAPSHOT_LIMITS = {
    product_name: 200,
    category_name: 160,
    product_price: 64,
    image_url: 512
};


// The row shape the browser speaks. Deliberately identical to the line shape
// cart-module.js has always held in memory and written to storage, so the
// module's own normalise() takes what this returns without a translation
// layer in between that could drift.
function publicCartItem(row) {
    return {
        id: String(row.product_id),
        name: row.product_name || '',
        category_name: row.category_name || '',
        price: row.product_price === null || row.product_price === undefined ? '' : String(row.product_price),
        image_url: row.image_url || '',
        quantity: row.quantity
    };
}

// MAX_CHECKOUT_LINES and MAX_LINE_QUANTITY are declared with the checkout
// block below. That is not a bug and must not be "fixed" by making a second
// copy here: they are module-scoped consts read at request time, long after
// this file has finished evaluating, and the cart deliberately shares
// checkout's numbers. A cart that can hold more than an order can carry is a
// trap — the customer fills it and finds out at the last screen.
function readCartItems(raw) {
    if (!Array.isArray(raw)) {
        return { ok: false, error: "A cart is a list of items." };
    }
    if (raw.length > MAX_CHECKOUT_LINES) {
        return { ok: false, error: `A cart can hold at most ${MAX_CHECKOUT_LINES} products.` };
    }

    // Collapsed by product id, and capped rather than refused. The unique
    // index on (user_id, product_id) makes two lines for one product
    // impossible to store, and the client already caps at the same number —
    // so a body that says otherwise is a stale or hand-made request, and
    // quietly meaning the sensible thing is a better answer than a 400 the
    // customer cannot act on.
    const byProduct = new Map();

    for (const entry of raw) {
        const productId = optionalId(entry && (entry.id !== undefined ? entry.id : entry.product_id));
        if (productId === null) {
            return { ok: false, error: "One of the items in your cart is not a real product." };
        }

        const quantity = Number.parseInt(entry && entry.quantity, 10);
        if (!Number.isFinite(quantity) || quantity < 1) {
            return { ok: false, error: "Every item needs a quantity of at least 1." };
        }

        const already = byProduct.get(productId);
        const total = Math.min((already ? already.quantity : 0) + quantity, MAX_LINE_QUANTITY);

        byProduct.set(productId, {
            product_id: productId,
            quantity: total,
            product_name: cut(entry.name !== undefined ? entry.name : entry.product_name, CART_SNAPSHOT_LIMITS.product_name),
            category_name: cut(entry.category_name, CART_SNAPSHOT_LIMITS.category_name),
            product_price: cut(entry.price !== undefined ? entry.price : entry.product_price, CART_SNAPSHOT_LIMITS.product_price),
            image_url: cut(entry.image_url, CART_SNAPSHOT_LIMITS.image_url)
        });
    }

    return { ok: true, items: [...byProduct.values()] };
}

module.exports = { CART_SNAPSHOT_LIMITS, publicCartItem, readCartItems };
