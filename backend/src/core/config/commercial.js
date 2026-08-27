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
 * THESE ARE STILL PLACEHOLDERS. `GST_RATE`, `SHIPPING_FLAT` and
 * `SHIPPING_FREE_ABOVE` carry the same conservative defaults they did in `#1`
 * and should be confirmed against the real commercial terms before live keys.
 *
 * Read once at boot, like everything else in this folder — so an edit to a
 * value here changes nothing until the process restarts, and
 * `POST /api/checkout/summary` is the one call that reports what the RUNNING
 * process believes.
 */
// Commercial values are deployment settings, not sample literals buried in
// code. Defaults are conservative and can be replaced without editing or
// restarting under watch mode after the environment is updated.
function commercialNumber(name, fallback, minimum, maximum) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
    }
    return value;
}
const GST_RATE = commercialNumber('GST_RATE', 0.18, 0, 1);
const SHIPPING_FLAT = commercialNumber('SHIPPING_FLAT', 1500, 0, 1000000);
const SHIPPING_FREE_ABOVE = commercialNumber('SHIPPING_FREE_ABOVE', 50000, 0, 100000000);

// GST is charged on the delivery too. Freight bundled with the goods it
// carries is a composite supply under Indian GST and takes the rate of the
// principal supply, so the taxable value is goods + delivery rather than
// goods alone.
const TAXABLE_INCLUDES_SHIPPING = true;

const MAX_LINE_QUANTITY = 99;          // matches the stepper in product-details-module.js
const MAX_CHECKOUT_LINES = 50;         // a ceiling nobody meets by accident

module.exports = {
    commercialNumber,
    GST_RATE,
    SHIPPING_FLAT,
    SHIPPING_FREE_ABOVE,
    TAXABLE_INCLUDES_SHIPPING,
    MAX_LINE_QUANTITY,
    MAX_CHECKOUT_LINES
};
