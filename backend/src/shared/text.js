/*
 * shared/text.js — turning a value into text something else can hold
 * ============================================================================
 *
 * Three functions with nothing in common but that: none of them knows a table,
 * a route or a role. `escapeHtmlText` is used by the one place this server
 * interpolates into HTML (modules/legal); `slugify` by modules/categories and
 * modules/products; `cut` by modules/cart, which stores what a browser told it
 * and must bound every column it writes.
 */

function slugify(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const cut = (value, limit) => String(value === null || value === undefined ? '' : value).slice(0, limit);

// The one place this server interpolates into HTML (the legal shell route
// below). Values come from a file in this repository and never from a request,
// so this is not standing between an attacker and anything today — it is here
// because a template that interpolates without escaping is a habit that
// outlives the reason it was safe.
function escapeHtmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = { escapeHtmlText, slugify, cut };
