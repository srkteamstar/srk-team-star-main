'use strict';
const { fetchProductRows, withProductImages } = require('../infrastructure/product.repository');

async function publicCatalogue() {
    const rows = await fetchProductRows();
    return rows.filter(product => product.is_active !== false).map(product => {
        const { id, name, url_slug, description, featured_description, price,
            category_id, category_name, is_featured, is_best_seller,
            is_new_arrival, images, image_url, created_at } = withProductImages(product);
        // Same public projection and seed-price safeguard as the public API.
        // Never expose internal product fields or advertise the ₹10 test price.
        return { id, name, url_slug, description, featured_description,
            price: String(id) === '9' && Number(price) === 10 ? 'On request' : price,
            category_id, category_name, is_featured, is_best_seller,
            is_new_arrival, images, image_url, created_at };
    });
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

module.exports = { publicCatalogue, selectMachineryHero };
