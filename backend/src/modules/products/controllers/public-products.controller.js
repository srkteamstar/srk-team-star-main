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
 *
 * PAGINATION IS OPT-IN. Pass ?page=1 (pageSize optional, capped at
 * PUBLIC_PAGE_MAX) to get `{ items, page, pageSize, hasMore }` — a bounded
 * SQL range() read, never an unbounded select(). Every caller in this
 * repository now asks for it this way (product-section-shared-module.js's
 * loadProducts(), and the two hero loaders' own fallback fetch, all page
 * until hasMore is false and reconstruct the flat array their callers
 * expect). Omitting ?page keeps the plain-array response this route has
 * always returned, for anything outside this repository that still calls
 * it that way — that response is still SQL-bounded underneath (see
 * fetchProductRows() in product.repository.js), just not paginated on the
 * wire, so it is a behaviour-preserving default rather than a silent cap.
 */
const express = require('express');
const { isMissingRelation, isPermissionDenied } = require('../../../core/database/postgrest-errors');
const { publicCatalogue, publicCatalogueList } = require('../services/public-catalogue.service');
const { SHARED_READ_CACHE } = require('../../../shared/http-caching');
const { errorTag } = require('../../../shared/error-tag');

/** @returns {import('express').Router} */
function publicProductsController() {
    const router = express.Router();

    router.get('/api/products/public', async (req, res) => {
        const paginated = typeof req.query.page !== 'undefined';

        try {
            if (paginated) {
                const result = await publicCatalogueList({ page: req.query.page, pageSize: req.query.pageSize });
                // Anonymous, read-only, and identical for every visitor asking
                // right now — set only on a genuine 200, never on the 500 below,
                // so a shared cache is never told to hold onto a failure. See
                // shared/http-caching.js for why the ETag half of this needs no
                // code of its own.
                res.set('Cache-Control', SHARED_READ_CACHE);
                return res.status(200).json(result);
            }

            const products = await publicCatalogue();
            res.set('Cache-Control', SHARED_READ_CACHE);
            res.status(200).json(products);
        } catch (error) {
            console.error("Fetch Public Products Error:", errorTag(error));

            // A storefront page must not break because the table isn't set up yet.
            // Missing table and missing grants are both "not provisioned", and an
            // empty catalogue degrades better than an error banner. Still cacheable
            // — it is still the honest, anonymous answer for everyone asking right
            // now — but not for as long as a real catalogue: a "not provisioned yet"
            // response ought to self-correct quickly once a migration actually runs.
            if (isMissingRelation(error) || isPermissionDenied(error)) {
                res.set('Cache-Control', SHARED_READ_CACHE);
                return res.status(200).json(paginated ? { items: [], page: 1, pageSize: 0, hasMore: false } : []);
            }
            res.status(500).json({ error: "Failed to fetch products." });
        }
    });


    return router;
}

module.exports = { publicProductsController };
