/*
 * modules/categories/controllers/public-categories.controller.js
 * ============================================================================
 *
 * GET /api/categories/public - active categories, with parent_id, which is
 * what makes the storefront's filter row hierarchy-aware: a product filed in a
 * sub-category rolls up into its root ancestor's tab instead of raising a peer
 * tab of its own.
 *
 * product_count is deliberately NOT on this response. Nothing public reads it,
 * and the count is derived where it is displayed.
 */
const express = require('express');
const { fetchCategoryRows, withImageUrl } = require('../infrastructure/category.repository');

/** @returns {import('express').Router} */
function publicCategoriesController() {
    const router = express.Router();

    router.get('/api/categories/public', async (req, res) => {
        try {
            const rows = await fetchCategoryRows();

            const categories = rows
                .filter(category => category.is_active !== false)
                .map(category => {
                    // product_count is NOT among these. Nothing reads it — not
                    // the storefront, and not the admin Categories tab either,
                    // which derives its own counts client-side from /api/products
                    // (countProductsPerCategory in categories.js). It was dead
                    // data on the wire that happened to publish how much of the
                    // catalogue is filed where.
                    const { id, name, url_slug, description, parent_id, is_featured, image_url } = withImageUrl(category);
                    return { id, name, url_slug, description, parent_id, is_featured, image_url };
                });

            res.status(200).json(categories);
        } catch (error) {
            console.error("Fetch Public Categories Error:", error);
            res.status(500).json({ error: "Failed to fetch categories." });
        }
    });


    return router;
}

module.exports = { publicCategoriesController };
