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

// Reads categories together with their cover image and their live product count.
// Preferred path is the categories_with_image view from the migration, which
// knows whether the object actually exists. If the migration hasn't been run the
// view is missing, so fall back to the bare table and assume `<id>-cover` —

// Reads products together with their grouped images, mirroring fetchCategoryRows().
// Preferred path is the products_with_image view, which aggregates every image in
// one query and carries the joined category name. Without it, fall back to the
// bare table and resolve categories and images with two extra queries — still a
// fixed cost, never per-product.
async function fetchProductRows() {
    const fromView = await supabase
        .from('products_with_image')
        .select('*')
        .order('name', { ascending: true });

    if (!fromView.error) return fromView.data || [];

    // Only a missing view justifies the fallback — a real error must surface.
    if (!isMissingRelation(fromView.error)) throw fromView.error;

    const fromTable = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true });

    if (fromTable.error) throw fromTable.error;

    const rows = fromTable.data || [];
    const categoryNames = new Map();

    // Best-effort: a missing/unreadable categories table just means no label.
    if (rows.some(product => product.category_id)) {
        const { data, error } = await supabase.from('categories').select('id, name');
        if (!error) (data || []).forEach(category => categoryNames.set(String(category.id), category.name));
    }

    // Same shape the view produces, assembled in one query and grouped in JS.
    const imagesByProduct = new Map();
    if (rows.length) {
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
    }

    return rows.map(product => ({
        ...product,
        category_name: product.category_id ? (categoryNames.get(String(product.category_id)) || null) : null,
        images: imagesByProduct.get(String(product.id)) || []
    }));
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
    fetchProductRows,
    withProductImages,
    findActiveProductsByIds,
    findProductsForQuoteByIds
};
