/*
 * modules/categories/categories.module.js - the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the categories table, the categories_with_image view, and the
 *   category-images storage bucket
 *
 *   GET    /api/categories/public       anonymous
 *
 * WHAT IT IMPORTS FROM A SIBLING
 *   modules/products/products.public.js -> countProductsByCategory, and
 *   nothing else. That is the module's ONLY cross-boundary edge, it is a read,
 *   and it goes through the published interface.
 *
 * THE ORIGINAL SECTION HEADER
 *
 * Same storage convention as upcoming_projects: one cover per row, stored as
 * `<id>-cover` in a public bucket. See backend/migrations/001_categories.sql.
 */
const express = require('express');
const { publicCategoriesController } = require('./controllers/public-categories.controller');

/** @returns {import('express').Router} */
function categoriesModule() {
    const router = express.Router();
    router.use(publicCategoriesController());
    return router;
}

module.exports = { categoriesModule };
