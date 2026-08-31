/*
 * modules/products/products.module.js - the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the products and product_images tables, and the product-images bucket
 *   GET    /api/products/public       anonymous
 *
 * WHAT IT PUBLISHES  see products.public.js - two read ports, no writes.
 * WHAT IT IMPORTS    core and shared only. It reaches into no sibling.
 *
 * THE ORIGINAL SECTION HEADER
 *
 * Same storage convention as categories: one cover per row, stored as
 * `<id>-cover` in a public bucket.
 *
 * NOTE: backend/migrations/002_products.sql has not been written/run yet, so the
 * `products` table, the `products_with_image` view and the `product-images`
 * bucket do not exist. Every route below therefore distinguishes "not set up
 * yet" (503 + the migration name) from a genuine fault (500), so the dashboard
 * shows an actionable message instead of a blank table.
 */
const express = require('express');
const { publicProductsController } = require('./controllers/public-products.controller');
const { productPagesController } = require('./controllers/product-pages.controller');

/** @returns {import('express').Router} */
function productsModule() {
    const router = express.Router();
    router.use(publicProductsController());
    return router;
}

function productPagesModule() { return productPagesController(); }

module.exports = { productsModule, productPagesModule };
