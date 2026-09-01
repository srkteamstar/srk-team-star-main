'use strict';
const {
    fetchProductRows, fetchProductRowsPage, fetchProductRowBySlugOrId,
    withProductImages, PUBLIC_PAGE_MAX
} = require('../infrastructure/product.repository');

// The one public projection and seed-price safeguard, shared by every path
// that hands a product row to a browser or a crawler: the full catalogue
// read below, the bounded page read, and the single-row detail lookup.
// Never expose internal product fields (asset_folder, internal notes, ...)
// or advertise the ₹10 seed/test price as real.
function toPublicProduct(row) {
    const { id, name, url_slug, description, featured_description, price,
        category_id, category_name, is_featured, is_best_seller,
        is_new_arrival, images, image_url, created_at } = withProductImages(row);
    return { id, name, url_slug, description, featured_description,
        price: String(id) === '9' && Number(price) === 10 ? 'On request' : price,
        category_id, category_name, is_featured, is_best_seller,
        is_new_arrival, images, image_url, created_at };
}

async function publicCatalogue() {
    const rows = await fetchProductRows();
    // fetchProductRows() already filters is_active in SQL; this stays as a
    // second, defence-in-depth filter rather than trusting that entirely -
    // it is also what keeps this function correct against its own bare-table
    // fallback path and against a caller that hands it unfiltered rows.
    return rows.filter(product => product.is_active !== false).map(toPublicProduct);
}

/**
 * One bounded, validated page of the same public catalogue — for
 * GET /api/products/public's paginated mode. size is clamped to
 * PUBLIC_PAGE_MAX regardless of what a caller asks for.
 */
async function publicCatalogueList({ page = 1, pageSize = PUBLIC_PAGE_MAX } = {}) {
    const size = Math.min(Math.max(1, Math.trunc(Number(pageSize)) || PUBLIC_PAGE_MAX), PUBLIC_PAGE_MAX);
    const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
    const rows = await fetchProductRowsPage({ offset: (pageNum - 1) * size, limit: size });
    const items = rows.filter(product => product.is_active !== false).map(toPublicProduct);
    return { items, page: pageNum, pageSize: size, hasMore: rows.length === size };
}

/** One public product, by its indexed url_slug (numeric-id bookmarks fall back). */
async function publicProductBySlugOrId(slugOrId) {
    const row = await fetchProductRowBySlugOrId(slugOrId);
    if (!row || row.is_active === false) return null;
    return toPublicProduct(row);
}

// ---- The landing hero's first, server-rendered slide -----------------
//
// public/js/modules/storefront/sections/machinery-hero-loader.js builds its
// slideshow from this same public catalogue and picks its first slide with
// one rule: the first Machinery-category product in the (alphabetically
// sorted) public catalogue — falling back to a product's own joined
// category_name whenever it cannot resolve a category subtree client-side.
// That fallback rule is what this reads too, so the home page's
// server-rendered hero and the browser's own first slide are drawn from one
// rule rather than two copies of it that can drift apart.
//
// CACHED for HERO_CACHE_MS. Before this existed nothing on the public home
// page read the database at all; a full catalogue read on every landing-page
// hit is exactly the public-route database cost P01/P04 exist to avoid, for
// a value that only needs to be a few seconds stale.
const HERO_CACHE_MS = 30000;
let heroCache = null;

async function selectMachineryHero() {
    if (heroCache && (Date.now() - heroCache.at) < HERO_CACHE_MS) return heroCache.value;

    let value = null;
    try {
        const products = await publicCatalogue();
        const hero = products.find(product =>
            String(product.category_name || '').trim().toLowerCase() === 'machinery' && product.image_url);
        value = hero ? { id: hero.id, name: hero.name, image_url: hero.image_url } : null;
    } catch (_) {
        value = null; // The client-side loader still tries; this is only the first paint.
    }

    heroCache = { at: Date.now(), value };
    return value;
}

module.exports = { publicCatalogue, publicCatalogueList, publicProductBySlugOrId, selectMachineryHero };
