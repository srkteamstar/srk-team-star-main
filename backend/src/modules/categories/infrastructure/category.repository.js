/*
 * modules/categories/infrastructure/category.repository.js
 * ============================================================================
 *
 * Reads a category together with its cover image.
 *
 * THIS USED TO ALSO READ A LIVE PRODUCT COUNT, computed by
 * modules/products through its published read port on every call — including
 * the public storefront path, which never displayed it. public-categories
 * .controller.js already narrowed its response to fields the storefront
 * reads, but the count was still being COMPUTED first (a full scan of
 * products.category_id) and then discarded, which is real database cost for
 * a number nothing shows. It is gone from this read entirely now; an admin
 * surface that wants it again should ask modules/products for it directly,
 * the same published-interface way this file used to.
 *
 * The view-then-table fallback is unchanged. categories_with_image knows
 * whether the storage object actually exists; the bare table does not, so that
 * branch guesses <id>-cover the way /api/projects does.
 */
const { supabase } = require('../../../core/database/supabase');

const CATEGORY_BUCKET = 'category-images';

async function fetchCategoryRows() {
    const fromView = await supabase
        .from('categories_with_image')
        .select('*')
        .order('name', { ascending: true });

    if (!fromView.error) return fromView.data || [];

    const fromTable = await supabase
        .from('categories')
        .select('*')
        .order('name', { ascending: true });

    if (fromTable.error) throw fromTable.error;

    return (fromTable.data || []).map(category => ({
        ...category,
        image_path: `${category.id}-cover`,
        image_updated_at: category.updated_at
    }));
}

// ?v=<timestamp> so a replaced cover shows up immediately instead of being
// served from the browser cache.
function withImageUrl(category) {
    const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${CATEGORY_BUCKET}/`;
    const version = new Date(category.image_updated_at || category.updated_at || Date.now()).getTime();

    return {
        ...category,
        image_url: category.image_path ? `${baseUrl}${category.image_path}?v=${version}` : null
    };
}

module.exports = { CATEGORY_BUCKET, fetchCategoryRows, withImageUrl };
