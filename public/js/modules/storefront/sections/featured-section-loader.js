/**
 * featured-section-loader.js
 *
 * The store's "Featured Products" section: every active product the admin has
 * ticked as featured, in the order the customer chooses.
 *
 * Selection is the `is_featured` column and nothing else — no curation, no cap,
 * no fallback to "some products if none are flagged". A section that quietly
 * shows unflagged products when the flag list is empty teaches the admin that
 * the tick does not matter; an empty section teaches them to go and tick
 * something.
 *
 * Everything else — the card, the sort control, the fetch, the loading, empty
 * and error states — comes from product-section-shared-module.js, which is why
 * this file is a declaration rather than a page. There is no filter row here by
 * design: "Featured" is already the filter.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('featured-section-loader.js needs product-section-shared-module.js loaded first.');
        return;
    }

    section.register({
        policy: 'featured',
        wrapperId: 'dynamic-featured-wrapper',
        title: 'Featured Products',
        emptyMessage: 'No featured products yet. Check back soon.',

        // `=== true` rather than a truthy test: the column is nullable, and a
        // string "false" from a form-encoded round trip is truthy.
        select: (products) => products.filter(product => product.is_featured === true)
    });
})();
