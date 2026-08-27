/*
 * modules/products/services/product-errors.service.js
 * ============================================================================
 *
 * Turns a Supabase failure into an answer an administrator can act on. The
 * three predicates it branches on are core's (core/database/postgrest-errors),
 * because they describe the adapter; the sentences are this module's, because
 * they name this module's tables and migrations.
 */
const { isMissingRelation, isMissingColumn, isPermissionDenied } = require('../../../core/database/postgrest-errors');

function sendProductError(res, error, fallback) {
    // Point at the migration that actually provides the missing piece, rather
    // than always naming 002.
    const message = (error && error.message) || '';
    const migration = /product_images/.test(message)
        ? '004_product_images.sql'
        : /featured_description/.test(message)
            ? '005_featured_description.sql'
            : /is_best_seller|is_new_arrival/.test(message)
                ? '003_product_flags.sql'
            : '002_products.sql';

    if (isMissingRelation(error)) {
        return res.status(503).json({
            error: `A table this page needs does not exist yet. Run backend/migrations/${migration} in Supabase, then reload.`
        });
    }
    if (isMissingColumn(error)) {
        return res.status(503).json({
            error: `The products schema is missing something this form writes — ${message}. Run backend/migrations/${migration} to align it.`
        });
    }
    if (isPermissionDenied(error)) {
        return res.status(503).json({
            error: "Permission denied on the products table. Grant select/insert/update/delete to service_role, then reload."
        });
    }
    return res.status(500).json({ error: fallback });
}

// Up to four images per product, stored as product-images/<product id>/<slot>.

module.exports = { sendProductError };
