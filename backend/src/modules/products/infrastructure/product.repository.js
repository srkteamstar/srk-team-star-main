/*
 * modules/products/infrastructure/product.repository.js
 * ============================================================================
 *
 * Every read of the products table that more than one place needs, in one
 * file. One of these is this module's own; one is a READ PORT another module
 * holds through products.public.js and must never bypass:
 *
 *   findActiveProductsByIds   modules/checkout, which prices an order from
 *                             the catalogue and must never take a price from
 *                             a request body
 *
 * This used to also publish countProductsByCategory for modules/categories,
 * which spent a full scan of every product's category_id on every public
 * categories request to compute a number the storefront never displayed
 * (public-categories.controller.js explicitly left it off the response). It
 * was removed rather than fixed to filter, because nothing left in this
 * repository reads it — see category.repository.js for where it used to be
 * called from.
 */
const { supabase } = require('../../../core/database/supabase');
const { isMissingRelation, isPermissionDenied } = require('../../../core/database/postgrest-errors');

const PRODUCT_BUCKET = 'product-images';

// A page no browser-facing caller may exceed — see public-products.controller.js
// - and the batch size the "give me the whole catalogue" readers below page
// through internally. Both are comfortably under Supabase's default 1,000-row
// PostgREST response cap, so neither a browser page nor a full-catalogue read
// can be silently truncated by it the way one unbounded select() could.
const PUBLIC_PAGE_MAX = 50;
const INTERNAL_BATCH_SIZE = 200;

// Attaches the same category-name and grouped-image shape the
// products_with_image VIEW produces, for the bare-TABLE fallback path only
// (the view already carries both). Scoped to whatever `rows` a caller is
// currently holding — one page or the whole table — never a second
// unbounded read of its own.
async function attachFallbackJoins(rows) {
    if (!rows.length) return rows;

    const categoryNames = new Map();
    // Best-effort: a missing/unreadable categories table just means no label.
    if (rows.some(product => product.category_id)) {
        const { data, error } = await supabase.from('categories').select('id, name');
        if (!error) (data || []).forEach(category => categoryNames.set(String(category.id), category.name));
    }

    const imagesByProduct = new Map();
    const { data, error } = await supabase
        .from('product_images')
        .select('product_id, slot, is_main, updated_at')
        .in('product_id', rows.map(product => product.id));

    if (!error) {
        (data || []).forEach(image => {
            const list = imagesByProduct.get(String(image.product_id)) || [];
            list.push({
                slot: image.slot,
                is_main: image.is_main,
                path: `${image.product_id}/${image.slot}`,
                updated_at: image.updated_at
            });
            imagesByProduct.set(String(image.product_id), list);
        });
        imagesByProduct.forEach(list => list.sort((a, b) => a.slot - b.slot));
    }

    return rows.map(product => ({
        ...product,
        category_name: product.category_id ? (categoryNames.get(String(product.category_id)) || null) : null,
        images: imagesByProduct.get(String(product.id)) || []
    }));
}

/**
 * One bounded page of public-eligible product rows — active-or-null,
 * filtered and ordered in SQL rather than fetched in full and filtered
 * afterward, `range()`-limited so a single call can never ask Supabase for
 * more than `limit` rows. `order('id')` breaks ties after `order('name')`
 * so a product sharing a name with another can never appear on two pages,
 * or on none, as rows shift between requests.
 *
 * Preferred path is the products_with_image view, which aggregates every
 * image in one query and carries the joined category name. Without it
 * (migration not yet run), fall back to the bare table and resolve
 * categories and images for just this page — still a fixed cost, never
 * per-product, and never a second unbounded read.
 */
async function fetchProductRowsPage({ offset = 0, limit = PUBLIC_PAGE_MAX } = {}) {
    const size = Math.min(Math.max(1, Number(limit) || PUBLIC_PAGE_MAX), PUBLIC_PAGE_MAX);
    const start = Math.max(0, Number(offset) || 0);

    const fromView = await supabase
        .from('products_with_image')
        .select('*')
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + size - 1);

    if (!fromView.error) return fromView.data || [];

    // Only a missing view justifies the fallback — a real error must surface.
    if (!isMissingRelation(fromView.error)) throw fromView.error;

    const fromTable = await supabase
        .from('products')
        .select('*')
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + size - 1);

    if (fromTable.error) throw fromTable.error;

    return attachFallbackJoins(fromTable.data || []);
}

/**
 * Every public-eligible product row, for the handful of server-side readers
 * that legitimately need the complete catalogue rather than one page of it
 * — the sitemap, the plain-HTML /products page, the landing hero's first
 * pick (see public-catalogue.service.js). Loops fetchProductRowsPage()
 * INTERNAL_BATCH_SIZE at a time instead of ever issuing one unbounded
 * select(), so none of them can be silently truncated by Supabase's row cap
 * the way a single `select('*')` with no range could.
 *
 * publicCatalogue() still re-applies its own is_active filter over what
 * this returns, deliberately: this function's SQL-side filter is the
 * optimization (fewer rows crossing the wire), not the only enforcement of
 * "never show a withdrawn product" - see its own comment.
 */
async function fetchProductRows() {
    const all = [];
    let offset = 0;
    for (;;) {
        const page = await fetchProductRowsPage({ offset, limit: INTERNAL_BATCH_SIZE });
        all.push(...page);
        if (page.length < INTERNAL_BATCH_SIZE) break;
        offset += INTERNAL_BATCH_SIZE;
    }
    return all;
}

/**
 * One public-eligible product row, by its indexed url_slug — falling back
 * to a numeric id for bookmarks and links saved before url_slug existed
 * (?product=<id>, and any URL typed by hand before this lookup shipped).
 * Never scans the catalogue to find it: this is the fix for the finding
 * that used to read `(await publicCatalogue()).find(row => ...)` here.
 *
 * The id fallback only runs when the slug lookup finds nothing, so a slug
 * that happens to look numeric is never shadowed by an unrelated id.
 */
async function fetchProductRowBySlugOrId(slugOrId) {
    const value = String(slugOrId == null ? '' : slugOrId);
    if (!value) return null;

    const bySlug = await supabase
        .from('products_with_image')
        .select('*')
        .or('is_active.eq.true,is_active.is.null')
        .eq('url_slug', value)
        .maybeSingle();

    if (bySlug.error && !isMissingRelation(bySlug.error)) throw bySlug.error;
    if (!bySlug.error && bySlug.data) return bySlug.data;

    const numericId = /^\d+$/.test(value) ? Number(value) : null;

    if (!bySlug.error) {
        // View is provisioned and answered; only a numeric id is worth a
        // second lookup, and only against the same view.
        if (numericId === null) return null;
        const byId = await supabase
            .from('products_with_image')
            .select('*')
            .or('is_active.eq.true,is_active.is.null')
            .eq('id', numericId)
            .maybeSingle();
        if (byId.error) throw byId.error;
        return byId.data || null;
    }

    // View not provisioned yet: fall back to the bare table. No category or
    // image joins here, matching this file's other bare-table fallbacks —
    // the detail page renders a plain description and no photo rather than
    // paying for a join this bootstrap-only path does not need to justify.
    const bareBySlug = await supabase
        .from('products')
        .select('*')
        .or('is_active.eq.true,is_active.is.null')
        .eq('url_slug', value)
        .maybeSingle();
    if (bareBySlug.error) throw bareBySlug.error;
    if (bareBySlug.data) return bareBySlug.data;

    if (numericId === null) return null;
    const bareById = await supabase
        .from('products')
        .select('*')
        .or('is_active.eq.true,is_active.is.null')
        .eq('id', numericId)
        .maybeSingle();
    if (bareById.error) throw bareById.error;
    return bareById.data || null;
}

// Turns the raw `images` payload into public URLs, and lifts the main image to
// `image_url` so the admin table row and the storefront card can stay simple.
//
// ?v=<timestamp> is per image, so replacing slot 3 does not bust the cache on
// the other three.
function withProductImages(product) {
    const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${PRODUCT_BUCKET}/`;
    const raw = Array.isArray(product.images) ? product.images : [];

    const images = raw
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map(image => ({
            slot: image.slot,
            is_main: image.is_main === true,
            url: `${baseUrl}${image.path}?v=${new Date(image.updated_at || product.updated_at || Date.now()).getTime()}`
        }));

    // A product whose main flag never got set still needs a thumbnail, so the
    // lowest slot stands in rather than the row rendering blank.
    const main = images.find(image => image.is_main) || images[0] || null;

    return {
        ...product,
        images,
        main_slot: main ? main.slot : null,
        image_url: main ? main.url : null
    };
}

/**
 * The catalogue rows a checkout is priced from - id, name, price and whether
 * the product is still published, for a known set of ids.
 *
 * Returns Supabase's own { data, error } rather than throwing, because the
 * caller distinguishes "the query failed" (a 500) from "a product is missing
 * or withdrawn" (a refusal naming the product), and flattening the two would
 * lose that.
 */
function findActiveProductsByIds(ids) {
    return supabase
        .from('products')
        .select('id, name, price, is_active')
        .in('id', ids);
}

/**
 * The catalogue fields a quote calculation is allowed to snapshot. The view
 * supplies the category label as it exists at calculation time, so the quote
 * module never has to trust a browser-provided product or category name.
 */
async function findProductsForQuoteByIds(ids) {
    const fromView = await supabase
        .from('products_with_image')
        .select('id, name, price, is_active, category_id, category_name')
        .in('id', ids);

    if (!fromView.error) return fromView;
    if (!isMissingRelation(fromView.error)) return fromView;

    // A not-yet-provisioned view must not make the quote calculator trust the
    // client. Fall back to the owning table; the category label is deliberately
    // left null and the quote service gives it a neutral server-side label.
    return supabase
        .from('products')
        .select('id, name, price, is_active, category_id')
        .in('id', ids);
}

module.exports = {
    PRODUCT_BUCKET,
    PUBLIC_PAGE_MAX,
    fetchProductRows,
    fetchProductRowsPage,
    fetchProductRowBySlugOrId,
    withProductImages,
    findActiveProductsByIds,
    findProductsForQuoteByIds
};
