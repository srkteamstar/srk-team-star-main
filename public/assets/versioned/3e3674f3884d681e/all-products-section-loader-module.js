/**
 * all-products-section-loader-module.js
 *
 * The store's "All Products" view: the whole active catalogue, with a category
 * filter row above it.
 *
 * The card, the sort control, the fetch and the loading / empty / error states
 * all come from product-section-shared-module.js. The filter row itself —
 * tab-building, the "Common ▾" capsule dropdown for a category with children,
 * the capture-phase click interception, the keyboard path — also lives there
 * now, as `categoryFilterRow()`, since catalogue.html's rebuild needed the
 * identical behaviour and a second hand-maintained copy is exactly the kind of
 * near-miss duplicate this file's own shared module was extracted to stop. What
 * is left here is a one-line configuration of it: this section's default-open
 * tab name, its own `<style>` id, and its gold tick colour.
 *
 * SUB-CATEGORY TABS
 * -----------------
 * Categories nest (categories.parent_id), and a flat tab row would put a parent
 * and its children side by side as if they were peers — "Machine Spare Parts",
 * "Blades", "Motors", all at the same level, with no hint that the last two sit
 * inside the first. So a child's products roll up into its root ancestor's tab,
 * and that tab becomes a dropdown listing the children:
 *
 *     Machine Spare Parts (Common) ▾
 *                                  ├─ Common
 *                                  ├─ Blades
 *                                  └─ Motors
 *
 * The bracket always shows the dropdown's current value, so the capsule says
 * what it is filtering by without being opened. "Common" — the default — means
 * the products filed directly on the parent itself, not on any child; picking a
 * child narrows to that child and anything nested under it.
 *
 * This is not special-cased on the name "Spare Parts": any tab whose category
 * has children becomes a dropdown, so adding or renaming a parent category in
 * the back office needs no change here. The children come from the categories
 * table, not from the products, so a child with nothing in it yet is still
 * offered.
 *
 * EVERY ACTIVE ROOT CATEGORY GETS A TAB, PRODUCTS OR NOT
 * --------------------------------------------------------
 * This used to be product-derived at the top level — a root with zero
 * products anywhere under it raised no tab at all — so a customer could
 * never click into a grid that was always going to be empty. By request, the
 * rule is now the same simple one on both pages this filter row appears on
 * (here and catalogue.html): a category shows up the moment it is active,
 * whether or not anything has been filed under it yet. Clicking an empty tab
 * shows the shared module's own "No products found in this category."
 * message rather than never appearing in the row. `categoryFilterRow`'s
 * `allCategories: true` is what switches the rule; the parent/child capsule
 * behaviour above is completely unaffected by it — a tab still only becomes
 * a dropdown when its category actually has children in the database.
 *
 * If /api/categories/public cannot be reached the view degrades to the flat row
 * it had before: every category with products gets its own plain tab.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('all-products-section-loader-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    // The tab this section opens on, if a matching one was raised. Matched by
    // name, not id — the site has no stable "this is the core catalogue" flag,
    // and the name is what "Machinery" already means everywhere else on the
    // site (index.html's "Explore Machinery", crousel-and-data-module.js),
    // which is the same reason request-quote-module.js defaults its category
    // the same way. Case-insensitive so a capitalisation change in the admin
    // dashboard does not silently break it; absent entirely — no such category,
    // or nothing published under it — the row falls back to "All" as before.
    //
    // A Machinery tab that has children opens on its own "Common" option,
    // because that is a capsule's first option and so exactly what clicking
    // the tab by hand would have given: the default and a click agree.
    const filters = section.categoryFilterRow({
        defaultTabName: 'machinery',
        styleId: 'all-products-filter-styles',
        tickColor: '#d4af37',
        // Same rule as catalogue.html, deliberately: an active category is a
        // real part of the catalogue and gets a tab whether or not a product
        // has been filed under it yet. See the file header.
        allCategories: true
    });

    section.register({
        policy: 'all-products',
        wrapperId: 'dynamic-catalog-wrapper',
        title: 'All Products',
        emptyMessage: 'No products are published yet. Check back soon.',
        filters
    });
})();
