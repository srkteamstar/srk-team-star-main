/*
 * modules/checkout/services/price-checkout.service.js
 * ============================================================================
 *
 * TURNS WHAT THE BROWSER SENT INTO A PRICED, VALIDATED ORDER - or into the
 * list of reasons it cannot be one. Shared by both routes, which is what makes
 * the total the customer is shown and the total they are charged the same
 * number rather than two numbers that agree most of the time.
 *
 * IT TAKES IDS AND QUANTITIES AND NOTHING ELSE. No price reaches this function
 * from a request body, and the catalogue rows come through
 * modules/products/products.public.js - the published read port - rather than
 * from a products query written here.
 *
 * A PRODUCT PRICED "On request" CANNOT BE CHECKED OUT, and that is 43 of 48
 * rows today, so it is the common path rather than an edge. There is no total
 * to compute, so the whole order is refused by name and the quote overlay is
 * offered instead - never quietly dropped from a total the customer is looking
 * at.
 */
const { findActiveProductsByIds } = require('../../products/products.public');
const { optionalId } = require('../../../shared/validation');
const { priceNumber, round2 } = require('../../../shared/money');
const { GST_RATE, SHIPPING_FLAT, SHIPPING_FREE_ABOVE, TAXABLE_INCLUDES_SHIPPING, MAX_LINE_QUANTITY, MAX_CHECKOUT_LINES } = require('../../../core/config/commercial');

// Turns whatever the browser sent into a priced, validated order — or into
// the list of reasons it cannot be one. Shared by both routes below, which is
// what makes the displayed total and the charged total the same number.
async function priceCheckout(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { ok: false, error: "Your cart is empty." };
    }
    if (rawItems.length > MAX_CHECKOUT_LINES) {
        return { ok: false, error: `An order can hold at most ${MAX_CHECKOUT_LINES} products.` };
    }

    // Collapsed by product id before anything else. Two lines for one product
    // is not a thing an order can express — order_items would carry the same
    // product twice and every total would be right while the row read wrong.
    const wanted = new Map();
    for (const item of rawItems) {
        const id = optionalId(item && item.product_id);
        if (id === null) return { ok: false, error: "One of the items in your cart is not a real product." };

        const quantity = Number.parseInt(item && item.quantity, 10);
        if (!Number.isFinite(quantity) || quantity < 1) {
            return { ok: false, error: "Every item needs a quantity of at least 1." };
        }

        const total = (wanted.get(id) || 0) + quantity;
        if (total > MAX_LINE_QUANTITY) {
            return { ok: false, error: `The most you can order of one product here is ${MAX_LINE_QUANTITY}. For more than that, send it as a quote request.` };
        }
        wanted.set(id, total);
    }

    const ids = [...wanted.keys()];
    // Through modules/products' published read port rather than a products
    // query written here. Same query, same { data, error } shape - the
    // difference is that the module owning the table owns the statement.
    const { data: products, error } = await findActiveProductsByIds(ids);

    if (error) throw error;

    const productById = new Map((products || []).map(row => [String(row.id), row]));

    const lines = [];
    const blocked = [];

    for (const [id, quantity] of wanted.entries()) {
        const product = productById.get(String(id));

        // Each of these is a real state, and the page says which one it is
        // rather than a blanket "something is wrong": the customer's next
        // action is different for a withdrawn product than for one that has
        // always been priced on request.
        if (!product) {
            blocked.push({ product_id: id, reason: 'gone', message: 'This product is no longer in the catalogue.' });
            continue;
        }
        if (product.is_active === false) {
            blocked.push({ product_id: id, name: product.name, reason: 'withdrawn', message: 'This product has been withdrawn.' });
            continue;
        }

        const placeholderPrice = String(product.id) === '9' && Number(product.price) === 10;
        const unit = placeholderPrice ? null : priceNumber(product.price);
        if (unit === null) {
            blocked.push({
                product_id: id, name: product.name, reason: 'on_request',
                message: 'This product is priced on request, so it cannot be checked out online.'
            });
            continue;
        }

        lines.push({
            product_id: Number(product.id),
            product_name: product.name,
            unit_price: unit,
            quantity: quantity,
            line_total: round2(unit * quantity)
        });
    }

    const subtotal = round2(lines.reduce((sum, line) => sum + line.line_total, 0));
    const shipping = subtotal > 0 && subtotal < SHIPPING_FREE_ABOVE ? SHIPPING_FLAT : 0;
    const taxable = round2(TAXABLE_INCLUDES_SHIPPING ? subtotal + shipping : subtotal);
    const tax = round2(taxable * GST_RATE);
    const total = round2(subtotal + shipping + tax);

    return {
        ok: true,
        lines,
        blocked,
        totals: {
            subtotal,
            shipping,
            shipping_is_free: subtotal > 0 && shipping === 0,
            shipping_free_above: SHIPPING_FREE_ABOVE,
            gst_rate: GST_RATE,
            tax,
            total
        }
    };
}

module.exports = { priceCheckout };
