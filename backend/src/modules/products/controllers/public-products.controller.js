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
const { publicCatalogue } = require('../services/public-catalogue.service');

/** @returns {import('express').Router} */
function publicProductsController() {
    const router = express.Router();

    router.get('/api/products/public', async (req, res) => {
        try {
            const products = await publicCatalogue();

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
