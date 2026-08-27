/*
 * modules/products/controllers/public-products.controller.js
 * ============================================================================
 *
 * GET /api/products/public - the one route every product surface on the site
 * reads: the store's four sections, the catalogue page, the search overlay,
 * the cart's re-resolution and the quote form's picker.
 *
 * It returns strictly less than the full row. asset_folder was removed
 * because it is an internal disk layout, and product_count off the categories
 * equivalent for the same reason: nothing public read either.
 */
const express = require('express');
const { isMissingRelation, isPermissionDenied } = require('../../../core/database/postgrest-errors');
const { fetchProductRows, withProductImages } = require('../infrastructure/product.repository');
const { sendProductError } = require('../services/product-errors.service');

/** @returns {import('express').Router} */
function publicProductsController() {
    const router = express.Router();

    router.get('/api/products/public', async (req, res) => {
        try {
            const rows = await fetchProductRows();

            const products = rows
                .filter(product => product.is_active !== false)
                .map(product => {
                    // created_at rides along so the storefront's "Newest" sort has a
                    // real key. It is a publication date, not internal detail.
                    // asset_folder is NOT among these, and its removal was
                    // checked rather than assumed: the only readers of that field
                    // anywhere in the repo are in products.js, which is the admin
                    // tab. No storefront file has ever read it. It is an internal
                    // filesystem naming convention (assets/products/<Name>/), so
                    // publishing it told every visitor how the server lays out
                    // its disk in exchange for nothing being rendered.
                    const {
                        id, name, url_slug, description, featured_description, price,
                        category_id, category_name,
                        is_featured, is_best_seller, is_new_arrival, images, image_url,
                        created_at
                    } = withProductImages(product);

                    // Product 9 is an industrial press that was seeded at ₹10 as a
                    // smoke-test value. Never advertise or accept that value while
                    // the corrective migration is waiting to be applied.
                    const publicPrice = String(id) === '9' && Number(price) === 10 ? 'On request' : price;
                    return {
                        id, name, url_slug, description, featured_description, price: publicPrice,
                        category_id, category_name,
                        is_featured, is_best_seller, is_new_arrival, images, image_url,
                        created_at
                    };
                });

            res.status(200).json(products);
        } catch (error) {
            console.error("Fetch Public Products Error:", error);

            // A storefront page must not break because the table isn't set up yet.
            // Missing table and missing grants are both "not provisioned", and an
            // empty catalogue degrades better than an error banner.
            if (isMissingRelation(error) || isPermissionDenied(error)) return res.status(200).json([]);
            res.status(500).json({ error: "Failed to fetch products." });
        }
    });


    return router;
}

module.exports = { publicProductsController };
