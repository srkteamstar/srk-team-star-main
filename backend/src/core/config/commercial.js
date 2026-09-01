/*
 * core/config/commercial.js — the numbers the business sets, not the code
 * ============================================================================
 *
 * GST, delivery and the two ceilings an order is held to. In core/config
 * because they are deployment settings read from the environment at boot,
 * which is what that folder is for — and because more than one module needs
 * them: modules/checkout prices with the money three, modules/cart and
 * modules/quotes both bound a line against MAX_LINE_QUANTITY.
 *
 * Confirmed commercial terms: GST is 18%; delivery is collected at delivery
 * and is free for orders of at least Rs 50,000.
 *
 * Read once at boot, like everything else in this folder — so an edit to a
 * value here changes nothing until the process restarts, and
 * `POST /api/checkout/summary` is the one call that reports what the RUNNING
 * process believes.
 *
 * IN PRODUCTION, THE FALLBACK BELOW IS NOT A VALUE — IT IS A MISSING
 * DEPLOYMENT STEP. Falling back to it silently in a real deployment means an
 * operator who forgot to set GST_RATE or SHIPPING_FREE_ABOVE gets a fully
 * working checkout that charges the placeholder numbers with nothing at
 * startup to say so. commercialNumber() below still returns the fallback for
 * test/development — nothing about the VALUES here changes, and this file
 * has no authority to decide what the real business numbers are — but once
 * NODE_ENV=production it refuses to start rather than guess.
 */
// Commercial values are deployment settings, not sample literals buried in
// code. Defaults are confirmed business terms and can be replaced without a
// code edit; environment changes still take effect only after a restart.
const { isProduction } = require('./runtime');

function commercialNumber(name, fallback, minimum, maximum) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        if (isProduction) {
            throw new Error(`${name} must be set explicitly in production — no fallback is used once NODE_ENV=production (or VERCEL is set). The current placeholder default is ${fallback}; confirm the real business figure and set ${name} in the deployment environment.`);
        }
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
    }
    return value;
}
const GST_RATE = commercialNumber('GST_RATE', 0.18, 0, 1);
const SHIPPING_FREE_ABOVE = commercialNumber('SHIPPING_FREE_ABOVE', 50000, 0, 100000000);
const SHIPPING_COLLECT_ON_DELIVERY = true;

// Delivery is collected separately at the destination, so it is outside the
// website order total and its tax is dealt with when that charge is collected.
const TAXABLE_INCLUDES_SHIPPING = false;

const MAX_LINE_QUANTITY = 99;          // matches the stepper in product-details-module.js
const MAX_CHECKOUT_LINES = 50;         // a ceiling nobody meets by accident

module.exports = {
    commercialNumber,
    GST_RATE,
    SHIPPING_FREE_ABOVE,
    SHIPPING_COLLECT_ON_DELIVERY,
    TAXABLE_INCLUDES_SHIPPING,
    MAX_LINE_QUANTITY,
    MAX_CHECKOUT_LINES
};
