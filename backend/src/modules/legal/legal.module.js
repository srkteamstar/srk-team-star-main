/*
 * modules/legal/legal.module.js — six URLs, one document
 * ============================================================================
 *
 * THE SIX POLICY PAGES ARE ONE DOCUMENT
 *
 * legal/home.html, privacy-policy.html, terms-of-service.html,
 * shipping-policy.html, return-policy.html and support-policy.html were six
 * files of 402 lines each — 2,412 lines — and a diff between any two of them
 * was THREE lines: the <title>, the body's data-active-policy, and one class
 * attribute on the sidebar. Everything else, header to footer, was copied.
 *
 * They had already drifted, which is the argument rather than the tidiness.
 * home.html's sidebar read `w-70`, and there is no `w-70` in Tailwind (it goes
 * 64, 72, 80) — so that one page's sidebar had no width rule at all while the
 * other five had `w-80`, and its background was #f1f5f9 against their
 * transparent. Nobody chose that. It is what six copies do.
 *
 * So there is one shell now, and this route fills in the three things that
 * differ. The URLs are unchanged — they are still real paths that a link, a
 * bookmark and a crawler all resolve — and the shell is read PER REQUEST, so
 * editing it behaves like editing any other file here: reload and it is there.
 * It lives under backend/ because it is a template rather than a page, which
 * also means PRIVATE_PATH already refuses to serve it as one.
 *
 * THE TITLES ARE READ, NOT WRITTEN DOWN AGAIN. policy-loader.js already holds
 * the authoritative map — it sets document.title when the visitor moves
 * between policies without a page load — so keeping a second copy here is
 * exactly the drift this route exists to end. It is parsed out of that file at
 * boot, the same read-rather-than-write pattern the CSP uses for
 * data-map-embed and data-razorpay-checkout: add a policy there and it is
 * served from here on the next restart, with nothing to keep in sync.
 *
 * WHAT CHANGED IN THE RESTRUCTURE. Only where the two files are read from:
 * the shell and policy-loader.js are both named by core/config/paths.js now
 * instead of being reached with path.join(__dirname, '..'). The route, the
 * URLs, the parse and the per-request read are untouched.
 */
const express = require('express');
const fs = require('fs');
const paths = require('../../core/config/paths');
const { escapeHtmlText } = require('../../shared/text');

const LEGAL_SHELL = paths.LEGAL_SHELL_HTML;

const LEGAL_ROUTES = (() => {
    const routes = new Map();

    try {
        const source = fs.readFileSync(paths.POLICY_LOADER_JS, 'utf8');
        const pattern = /(\w+):\s*\{\s*path:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*\}/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            routes.set(match[2].toLowerCase(), { policy: match[1], title: match[3] });
        }
    } catch (error) {
        console.error('Legal shell: could not read policy-loader.js.', error.message);
    }

    // A silent empty map would 404 all six policy pages, so it is said out
    // loud. Nothing falls back to a guess: the map is the contract.
    if (!routes.size) console.error('Legal shell: NO policy routes parsed — the six policy pages will 404.');
    else console.log(`Legal: ${routes.size} policy page(s) served from one shell.`);

    return routes;
})();

/** @returns {import('express').Router} */
function legalModule() {
    const router = express.Router();

    router.get(/^\/legal\/[\w-]+\.html$/i, (req, res, next) => {
        const route = LEGAL_ROUTES.get(req.path.toLowerCase());
        if (!route) return next();

        let shell;
        try {
            shell = fs.readFileSync(LEGAL_SHELL, 'utf8');
        } catch (error) {
            console.error('Legal shell: template unreadable.', error.message);
            return next();
        }

        // escapeHtml on both, even though every value comes from a file in this
        // repository rather than from the request. The route table is the only
        // input and it is trusted — but a template that interpolates without
        // escaping is a habit that outlives the reason it was safe.
        const html = shell
            .replace('{{TITLE}}', escapeHtmlText(route.title))
            .replace('{{POLICY}}', escapeHtmlText(route.policy));

        // The static middleware's own no-cache rule for .html cannot apply to a
        // route — this is the case CLAUDE.md warns about, where anything served
        // outside express.static has to set its own headers. Without it a browser
        // may serve a stale policy page out of its in-memory cache.
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(html);
    });

    return router;
}

module.exports = { legalModule, LEGAL_ROUTES };
