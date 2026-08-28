/*
 * modules/quotes/services/calculate-quote.service.js
 * ============================================================================
 *
 * Resolves a customer's product ids against the live catalogue and returns the
 * only pricing snapshot this application will save. Names and prices from the
 * browser are never accepted. The same function serves the live preview and
 * the final write, so a price changed between those two moments is recalculated
 * before the request becomes a record.
 *
 * This is a REQUEST estimate, not staff-issued commercial approval. Delivery
 * remains excluded under EX-WORKS terms, and products without a numeric
 * catalogue price remain explicitly "on request" rather than being assigned a
 * guessed value.
 */
const { findProductsForQuoteByIds } = require('../../products/products.public');
const { priceNumber, round2 } = require('../../../shared/money');
const { GST_RATE, MAX_LINE_QUANTITY } = require('../../../core/config/commercial');
const { QUOTE_MAX_ITEMS } = require('../domain/quote-status');

const CALCULATION_VERSION = 'quote-request-v1';
const CURRENCY = 'INR';
const COMMERCIAL_BASIS = 'EX-WORKS';
const UNCATEGORISED_LABEL = 'Other Products';

function strictProductId(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validateLines(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { ok: false, error: 'Add at least one product to request a quote for.' };
    }
    if (rawItems.length > QUOTE_MAX_ITEMS) {
        return { ok: false, error: `A single request can hold at most ${QUOTE_MAX_ITEMS} products.` };
    }

    const wanted = [];
    for (let index = 0; index < rawItems.length; index++) {
        const item = rawItems[index] || {};
        const productId = strictProductId(item.product_id);
        if (productId === null) {
            return { ok: false, error: `Product request #${index + 1} is not a real catalogue product.` };
        }

        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
            return { ok: false, error: `Product request #${index + 1} needs a quantity from 1 to ${MAX_LINE_QUANTITY}.` };
        }

        wanted.push({ position: index + 1, product_id: productId, quantity });
    }

    return { ok: true, wanted };
}

async function calculateQuote(rawItems) {
    const validated = validateLines(rawItems);
    if (!validated.ok) return validated;

    const ids = [...new Set(validated.wanted.map(item => item.product_id))];
    const { data: products, error } = await findProductsForQuoteByIds(ids);
    if (error) throw error;

    const productById = new Map((products || []).map(product => [String(product.id), product]));
    const lines = validated.wanted.map(item => {
        const product = productById.get(String(item.product_id));

        if (!product) {
            return {
                ...item,
                product_name: 'Unavailable product',
                category_id: null,
                category_name: UNCATEGORISED_LABEL,
                pricing_status: 'unavailable',
                unit_price: null,
                discount_amount: 0,
                taxable_value: null,
                gst_rate: GST_RATE,
                gst_amount: null,
                line_total: null,
                message: 'This product is no longer in the catalogue.'
            };
        }

        if (product.is_active === false) {
            return {
                ...item,
                product_name: product.name,
                category_id: product.category_id ?? null,
                category_name: product.category_name || UNCATEGORISED_LABEL,
                pricing_status: 'unavailable',
                unit_price: null,
                discount_amount: 0,
                taxable_value: null,
                gst_rate: GST_RATE,
                gst_amount: null,
                line_total: null,
                message: 'This product has been withdrawn.'
            };
        }

        // Product 9 once carried a ₹10 smoke-test value. Keep the same guard as
        // checkout and the public catalogue until migration 021 is everywhere.
        const placeholderPrice = String(product.id) === '9' && Number(product.price) === 10;
        const unitPrice = placeholderPrice ? null : priceNumber(product.price);
        const base = {
            ...item,
            product_name: product.name,
            category_id: product.category_id ?? null,
            category_name: product.category_name || UNCATEGORISED_LABEL,
            discount_amount: 0,
            gst_rate: GST_RATE
        };

        if (unitPrice === null) {
            return {
                ...base,
                pricing_status: 'on_request',
                unit_price: null,
                taxable_value: null,
                gst_amount: null,
                line_total: null,
                message: 'Price and availability will be confirmed by our team.'
            };
        }

        const taxableValue = round2(unitPrice * item.quantity);
        const gstAmount = round2(taxableValue * GST_RATE);
        return {
            ...base,
            pricing_status: 'priced',
            unit_price: unitPrice,
            taxable_value: taxableValue,
            gst_amount: gstAmount,
            line_total: round2(taxableValue + gstAmount),
            message: null
        };
    });

    const unavailableLines = lines.filter(line => line.pricing_status === 'unavailable').length;
    const unpricedLines = lines.filter(line => line.pricing_status === 'on_request').length;
    const pricedLines = lines.filter(line => line.pricing_status === 'priced');
    const subtotal = round2(pricedLines.reduce((sum, line) => sum + line.taxable_value, 0));
    const taxAmount = round2(pricedLines.reduce((sum, line) => sum + line.gst_amount, 0));
    const pricingComplete = unavailableLines === 0 && unpricedLines === 0;

    return {
        ok: true,
        can_submit: unavailableLines === 0,
        calculation_version: CALCULATION_VERSION,
        calculated_at: new Date().toISOString(),
        commercial_basis: COMMERCIAL_BASIS,
        delivery_included: false,
        lines,
        totals: {
            currency: CURRENCY,
            pricing_complete: pricingComplete,
            priced_subtotal: subtotal,
            discount_amount: 0,
            gst_rate: GST_RATE,
            tax_amount: taxAmount,
            estimated_total: pricingComplete ? round2(subtotal + taxAmount) : null,
            unpriced_lines: unpricedLines,
            unavailable_lines: unavailableLines
        }
    };
}

module.exports = {
    CALCULATION_VERSION,
    CURRENCY,
    COMMERCIAL_BASIS,
    calculateQuote,
    validateLines
};
