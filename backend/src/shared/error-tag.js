/*
 * shared/error-tag.js — S03: what a catch block is allowed to log
 * ============================================================================
 *
 * A Supabase/Postgres error's message can echo the value that caused it back
 * (a unique-violation names the duplicate value; a constraint failure can
 * name the offending column's content), and a Razorpay error can carry
 * request fragments. Every route that touches account, order or payment data
 * used to console.error the raw error object, which turns application logs
 * into a second, unaudited store of whatever a customer submitted.
 *
 * errorTag() is the allowlist: a short, stable code or name, never the
 * object itself. It was originally written once, locally, in
 * customer-auth.controller.js (still S03's first fix); this is that same
 * function, shared so every other controller logging a database/gateway
 * failure can use it instead of re-inventing — or skipping — the same
 * redaction.
 */
function errorTag(error) {
    return (error && (error.code || error.name)) || 'unknown_error';
}

module.exports = { errorTag };
