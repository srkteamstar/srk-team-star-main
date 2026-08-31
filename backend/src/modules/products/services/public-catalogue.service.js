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

module.exports = { publicCatalogue };
