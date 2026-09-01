/*
 * modules/products/products.public.js - what siblings may hold
 * ============================================================================
 *
 * THE ONLY FILE IN THIS MODULE ANOTHER MODULE MAY REQUIRE. Everything else
 * under modules/products/ is private to it, and tools/verify-boundaries.js
 * fails the build on an import that reaches past this file.
 *
 * Both entries are READ PORTS - narrow, query-shaped, and side-effect free.
 * That is the doctrine's rule for synchronous cross-module calls: reads may
 * cross a boundary through an explicit interface; writes may not cross at all.
 * Nothing here can change a product, and no sibling can reach a route.
 *
 * WHO HOLDS WHAT
 *   modules/checkout     findActiveProductsByIds
 *   modules/quotes       findProductsForQuoteByIds
 *
 * modules/categories used to hold countProductsByCategory here, to derive a
 * per-category product count. It was removed: the only caller was the public
 * categories path, which computed it on every request and never returned it
 * (see category.repository.js and public-categories.controller.js). A future
 * admin surface that wants the count back should add its own read port here,
 * scoped to where it is actually displayed.
 */
const {
    findActiveProductsByIds,
    findProductsForQuoteByIds
} = require('./infrastructure/product.repository');

module.exports = { findActiveProductsByIds, findProductsForQuoteByIds };
