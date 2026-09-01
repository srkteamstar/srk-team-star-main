/*
 * test/browser/catalogue-route.js — one test double for GET /api/products/public
 * ============================================================================
 *
 * WHY THIS EXISTS. P01 gave that route an opt-in paginated mode, and every
 * browser caller in this repository now uses it: loadProducts() in
 * public/js/shared/product-section-shared-module.js, and both hero loaders'
 * fallback fetch, request `?page=1` and read `{ items, hasMore }`, paging
 * until hasMore is false.
 *
 * Six specs stubbed the route with `route.fulfill({ json: array })` — the
 * shape it answers WITHOUT `?page`. Against the paginated client that reads
 * `body.items`, a bare array yields zero products, so every catalogue-backed
 * assertion timed out. The stubs were not wrong when they were written; the
 * contract moved underneath them.
 *
 * THIS MIRRORS THE REAL ROUTE, IT DOES NOT PAPER OVER IT. The decision is the
 * same one public-products.controller.js makes — `?page` present means the
 * envelope, absent means the plain array — so a client that stops paging, or
 * starts paging incorrectly, still fails these tests rather than being
 * quietly accommodated. Pagination is real here too: pageSize defaults small
 * enough that a fixture longer than one page exercises the loop.
 */

// Small on purpose. The real route caps at PUBLIC_PAGE_MAX (50); a fixture
// here is a handful of rows, and a page size of 50 would mean the paging loop
// never ran a second iteration in any test. Two forces it to.
const DEFAULT_PAGE_SIZE = 2;

/**
 * Builds the JSON body GET /api/products/public would return for `url`.
 *
 * @param {string} url       the request URL, including any query string
 * @param {object[]} products the full fixture catalogue
 * @returns {object[]|{items: object[], page: number, pageSize: number, hasMore: boolean}}
 */
function catalogueBody(url, products) {
    const query = new URL(url).searchParams;

    // No ?page at all: the plain-array response the route has always given
    // anything outside this repository. Preserved here for the same reason
    // the server preserves it.
    if (query.get('page') === null) return products;

    const page = Math.max(1, Number(query.get('page')) || 1);
    const pageSize = Math.max(1, Number(query.get('pageSize')) || DEFAULT_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const items = products.slice(offset, offset + pageSize);

    return { items, page, pageSize, hasMore: offset + pageSize < products.length };
}

/**
 * Routes GET /api/products/public to `products`, honouring the pagination
 * contract in both directions.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object[]} products
 */
async function routeCatalogue(page, products) {
    await page.route('**/api/products/public*', route => route.fulfill({
        json: catalogueBody(route.request().url(), products)
    }));
}

module.exports = { routeCatalogue, catalogueBody, DEFAULT_PAGE_SIZE };
