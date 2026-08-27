/**
 * price-format-module.js
 *
 * One place that decides how a product price is shown, used by the storefront
 * and by the storefront so the two can never drift apart.
 *
 * A price is stored as a bare number (66000). Everything cosmetic is added here:
 * the rupee sign, thousands grouping, and the "/ unit" suffix. Storing the raw
 * number and formatting at display time means the presentation can change later
 * without a migration or a rewrite of every saved row.
 *
 * Grouping is Indian (66,00,000 — not 6,600,000), since this is an India-facing
 * B2B catalogue.
 *
 * Anything that is not a plain number is passed through untouched, which keeps
 * "On request" readable and leaves older free-text values like "Rs 1,200 / box"
 * exactly as they were entered.
 *
 * The cart needs the same decisions in two more shapes, and they belong here
 * rather than in the cart so they cannot drift from the rule above:
 *
 *   parseProductPrice  the number behind the text, or null when there isn't
 *                      one. `products.price` is a `text` column, so "On
 *                      request" is a legal value and every sum has to cope.
 *   formatAmount       a rupee figure with no "/ unit" suffix. That suffix is
 *                      right on a unit price and wrong on a line or a total.
 */
(function () {
    'use strict';

    // The one place that decides what counts as a number. Commas are tolerated
    // on input so "66,000" parses rather than being read as free text.
    function numericValue(value) {
        if (value === null || value === undefined) return null;

        var raw = String(value).trim();
        if (!raw) return null;

        var numeric = raw.replace(/,/g, '');
        if (!/^\d+(\.\d+)?$/.test(numeric)) return null;

        var amount = Number(numeric);
        return isFinite(amount) ? amount : null;
    }

    // Indian grouping, matching formatProductPrice — 66,00,000, not 6,600,000.
    function group(amount) {
        return amount.toLocaleString('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }

    window.parseProductPrice = function (value) {
        return numericValue(value);
    };

    window.formatAmount = function (value) {
        var amount = numericValue(value);
        if (amount === null) return '';

        return '₹ ' + group(amount);
    };

    window.formatProductPrice = function (value) {
        if (value === null || value === undefined) return '';

        var raw = String(value).trim();
        if (!raw) return '';

        // Anything numericValue rejects is free text: "On request", or an older
        // row like "Rs 1,200 / box". It goes back exactly as it was entered.
        var amount = numericValue(raw);
        if (amount === null) return raw;

        return '\u20B9 ' + group(amount) + ' / unit';
    };
})();
