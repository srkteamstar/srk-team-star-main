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
 *   modules/categories   countProductsByCategory
 *   modules/checkout     findActiveProductsByIds
 *   modules/quotes       findProductsForQuoteByIds
 */
const {
    countProductsByCategory,
    findActiveProductsByIds,
    findProductsForQuoteByIds
} = require('./infrastructure/product.repository');

module.exports = { countProductsByCategory, findActiveProductsByIds, findProductsForQuoteByIds };
