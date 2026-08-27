/**
 * best-seller-section-loader.js
 *
 * The store's "Best Sellers" section: every active product the admin has ticked
 * as a best seller, in the order the customer chooses.
 *
 * Selection is the `is_best_seller` column and nothing else. It is not derived
 * from order volume — there is no orders table wired up — so this is an
 * editorial flag the admin sets, and the section reflects exactly what they set.
 *
 * THE HOME ROW
 * ------------
 * This file also declares the short "Best Sellers" row on the store home page —
 * the first four of the same selection, in front of a View All link to the
 * section above. One file, one `select`, so the row cannot advertise a product
 * the section does not list.
 *
 * Everything else — the card, the sort control, the fetch, the loading, empty
 * and error states — comes from product-section-shared-module.js, which is why
 * this file is a declaration rather than a page. There is no filter row here by
 * design: "Best Sellers" is already the filter.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('best-seller-section-loader.js needs product-section-shared-module.js loaded first.');
        return;
    }

    // `=== true` rather than a truthy test: the column is nullable, and a
    // string "false" from a form-encoded round trip is truthy.
    //
    // Named rather than written inline twice, because the section and the home
    // row below it have to agree on what a best seller is. Two copies of
    // `product.is_best_seller === true` would agree today and be one careless
    // edit from disagreeing silently — the home page showing four products the
    // page behind View All does not list.
    const isBestSeller = (products) => products.filter(product => product.is_best_seller === true);

    section.register({
        policy: 'best-sellers',
        wrapperId: 'dynamic-bestsellers-wrapper',
        title: 'Best Sellers',
        emptyMessage: 'No best sellers yet. Check back soon.',
        select: isBestSeller
    });

    // The short row on the store home page, in front of the section above.
    //
    // The flag is the whole rule here as well: with nothing ticked the row
    // removes itself rather than falling back to "some products", for the same
    // reason featured-section-loader.js refuses to — a section that quietly
    // fills itself teaches the admin that the tick does not matter.
    section.registerPreview({
        hostId: 'best-sellers-preview',
        gridId: 'best-sellers-preview-grid',
        title: 'Best Sellers',
        select: isBestSeller
    });
})();
