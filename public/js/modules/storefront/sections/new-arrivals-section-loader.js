/**
 * new-arrivals-section-loader.js
 *
 * The store's "New Arrivals" section: the two newest products from each active
 * category.
 *
 * WHY PER CATEGORY, AND NOT THE FLAG
 * ----------------------------------
 * Products carry an `is_new_arrival` tick, and this section deliberately does
 * not select on it. A flag has to be un-ticked by hand, so the section it feeds
 * goes stale silently — last spring's arrivals sit there until someone
 * remembers. `created_at` cannot go stale, and taking a fixed number per
 * category means a busy category cannot crowd a quiet one off the page: a
 * customer who came for mouldings sees new mouldings, not ten new machines.
 *
 * The tick still drives the "New Arrival" badge on the card, so a product can
 * appear here without the badge, and carry the badge in another section. The
 * badge describes the product; this section describes the shelf.
 *
 * WHICH CATEGORIES COUNT
 * ----------------------
 * Every active category row, sub-categories included — /api/categories/public
 * returns active rows only, so the tree it hands back *is* the list. A parent
 * and its child each get their own two, which is the reading that gives the
 * customer the most variety.
 *
 * A product with no category, or one filed under a category that has since been
 * deactivated or deleted, belongs to no active category and so appears here
 * under none. If the category tree cannot be fetched at all there is nothing to
 * check against, and rather than show an empty section the products are grouped
 * by whatever category_id they carry.
 *
 * THE HOME ROW
 * ------------
 * This file also declares the short "New Arrivals" row on the store home page —
 * the first four of the same selection, in front of a View All link to the
 * section above. One file, one `select`, so the row cannot advertise a product
 * the section does not list. That row replaced four hardcoded product cards
 * that had been sitting in store.html since before the catalogue went live.
 *
 * Everything else — the card, the sort control, the fetch, the loading, empty
 * and error states — comes from product-section-shared-module.js.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('new-arrivals-section-loader.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const { categoryKey, newestFirst, UNCATEGORISED } = section;

    const PER_CATEGORY = 2;

    function latestPerCategory(products, index) {
        // An empty tree means the categories call failed, not that no category
        // is active — so it cannot be used to exclude anything.
        const treeKnown = index.byId.size > 0;

        const buckets = new Map();

        products.forEach(product => {
            const key = categoryKey(product);
            if (key === UNCATEGORISED) return;
            if (treeKnown && !index.byId.has(key)) return;

            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(product);
        });

        const picked = [];
        buckets.forEach(list => {
            list.sort(newestFirst);
            picked.push(...list.slice(0, PER_CATEGORY));
        });

        return picked;
    }

    section.register({
        policy: 'new-arrivals',
        wrapperId: 'dynamic-new-arrivals-wrapper',
        title: 'New Arrivals',
        emptyMessage: 'No new arrivals yet. Check back soon.',
        select: latestPerCategory
    });

    // The short row on the store home page, in front of the section above.
    //
    // Declared here, from the same file and against the same `select`, so the
    // four products on the home page are four of the ones View All opens —
    // truncated, never separately chosen. The home page used to hold four
    // hardcoded product cards under this heading: a Pneumatic Underpinner at
    // ₹45,000 and three others that were never in the catalogue, with a View
    // All link to a section that had never heard of them.
    //
    // No `order`: newestFirst is the default and is the right one here twice
    // over — the section opens on 'newest' too, so the row leads with the
    // products the customer meets first when they follow the link, and a
    // section called New Arrivals showing anything but the newest would be
    // odd on its face.
    section.registerPreview({
        hostId: 'new-arrivals-preview',
        gridId: 'new-arrivals-preview-grid',
        title: 'New Arrivals',
        select: latestPerCategory
    });
})();
