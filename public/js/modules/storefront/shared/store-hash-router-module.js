/**
 * store-hash-router-module.js
 *
 * Deep-link into a store section by its data-policy: /store/store.html#all-products.
 * This is how off-store CTAs reach a store section, the same way `#quote`
 * (request-quote-module.js, or lazy-overlay-loader-module.js before it has
 * loaded) reaches the quote overlay — the catalogue's product cards and its
 * footer both land here.
 *
 * Extracted from an inline <script> in store.html so the page's script tags
 * can all carry `defer` (P06) — a document with any inline script is left
 * parser-blocking rather than have this run before the elements it queries
 * exist. Registered after every section file (each has registered the
 * handler it clicks into by the time DOMContentLoaded reaches this) and
 * before view-state-restore-module.js, which must stay last on the page and
 * which stands down while a hash is present, so its saved section cannot
 * overwrite the one asked for here.
 *
 * The hash stays in the URL. `#quote` drops its own because a refresh
 * should not reopen a half-filled form; a section is a place, and a refresh
 * should land back on it.
 *
 * "home" and "assistance" are excluded because they navigate, and "combos"
 * because no section is registered against it — it would only turn the
 * sidebar gold over whatever was already showing. Same list, and the same
 * reasoning, as view-state-restore-module.js's data-skip.
 */
(() => {
    'use strict';

    const NOT_A_SECTION = ['home', 'assistance', 'quote', 'combos'];

    const route = () => {
        let requested;
        try {
            requested = decodeURIComponent(window.location.hash.slice(1));
        } catch (error) {
            requested = '';
        }
        if (!requested || NOT_A_SECTION.indexOf(requested) !== -1) return;

        const target = document.querySelector(
            '.nav-btn[data-policy="' + CSS.escape(requested) + '"]');
        if (target) target.click();
    };

    document.addEventListener('DOMContentLoaded', route);

    // The in-page "View All" links are plain <a href="#new-arrivals">
    // rather than click handlers, so they stay real links — middle-click
    // and copy-link-address both work — and Back walks the sections in
    // reverse. Neither hash names an element, so the browser's own
    // fragment scroll finds nothing and leaves the page where it is.
    window.addEventListener('hashchange', route);
})();
