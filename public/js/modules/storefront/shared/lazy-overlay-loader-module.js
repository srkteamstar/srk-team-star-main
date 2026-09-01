/**
 * lazy-overlay-loader-module.js  (window.storeLazyOverlays)
 *
 * store.html used to ship request-quote-module.js (~1700 lines) and
 * product-details-module.js (~1150 lines) as parser-blocking scripts on
 * every visit, whether or not a visitor ever opens either overlay — most of
 * the store's total script weight, for functionality most page views never
 * use. This loads each on first genuine demand instead: the interaction
 * that would have opened the overlay loads the module (once), then calls
 * the exact same public entry point the module has always exposed
 * (window.productDetails.open / window.requestQuote.open).
 *
 * THE <script> TAGS STAY IN THE DOCUMENT, marked type="text/plain" so the
 * browser never fetches them on parse (an unrecognised type makes a
 * <script src> inert — no request, no execution) — that is what keeps
 * tools/build-web-assets.js hashing their `src` on every asset build
 * exactly as it does for every other local script. This loader reads that
 * already-correct, already-hashed URL off the tag rather than hardcoding a
 * second copy of it.
 *
 * Both target modules guard on window.productSection / window.storeOverlay
 * already existing (see their own file headers), so this must load after
 * product-section-shared-module.js and store-overlay-shared-module.js —
 * same as they always required — and before any section loader or card can
 * be clicked, which every deferred script satisfies by construction (all
 * run, in order, before DOMContentLoaded fires).
 */
(() => {
    'use strict';

    const pending = new Map();

    function ensure(markerId) {
        if (pending.has(markerId)) return pending.get(markerId);

        const tag = document.querySelector('script[data-lazy-module="' + markerId + '"]');
        if (!tag) {
            const failed = Promise.reject(new Error('lazy-overlay-loader: no tag for ' + markerId));
            failed.catch(() => {});
            pending.set(markerId, failed);
            return failed;
        }

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = tag.getAttribute('src');
            script.addEventListener('load', () => resolve());
            script.addEventListener('error', () => reject(new Error('lazy-overlay-loader: failed to load ' + markerId)));
            document.head.appendChild(script);
        });

        pending.set(markerId, promise);
        return promise;
    }

    const ensureProductDetails = () => ensure('product-details');
    const ensureRequestQuote = () => ensure('request-quote');

    // ---- Product details -------------------------------------------------
    //
    // Mirrors product-details-module.js's own document-capture click guard
    // (same card/link/modifier-key checks) until it has loaded; once
    // window.productDetails exists, its own listener owns every subsequent
    // click and this one is a deliberate no-op for it.
    document.addEventListener('click', (event) => {
        if (window.productDetails) return;

        const target = event.target;
        if (!target || !target.closest) return;

        const card = target.closest('article[data-product-id]');
        if (!card) return;
        if (target.closest('.cart-icon-btn, .buy-now-btn, .request-price-btn')) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const link = target.closest('a[href]');
        if (link && !link.hasAttribute('data-product-link')) return;

        const id = card.getAttribute('data-product-id');
        if (!id) return;

        event.preventDefault();
        ensureProductDetails()
            .then(() => { if (window.productDetails) window.productDetails.open(id); })
            .catch(error => console.error(error));
    }, true);

    // Enter on a focused product link already fires a native 'click' the
    // listener above catches. Space does not - product-details-module.js's
    // own keydown listener is what normally handles it, so until that has
    // loaded this mirrors it, or a keyboard-only visitor whose first touch
    // on a card is Space (never Enter, never a click) would load nothing.
    document.addEventListener('keydown', (event) => {
        if (window.productDetails) return;
        if (event.key !== ' ') return;

        const target = event.target;
        if (!target || !target.closest) return;
        const card = target.closest('article[data-product-id]');
        if (!card || !target.matches('[data-product-link]')) return;

        const id = card.getAttribute('data-product-id');
        if (!id) return;

        event.preventDefault();
        ensureProductDetails()
            .then(() => { if (window.productDetails) window.productDetails.open(id); })
            .catch(error => console.error(error));
    }, true);

    // ---- Request a quote ---------------------------------------------------
    //
    // Three triggers, mirroring request-quote-module.js's own: the sidebar
    // button, an unpriced card's "Request price" button, and the #quote
    // hash a link on every other page can arrive with. Once
    // window.requestQuote exists, its own listeners (and its own
    // previousNav bookkeeping for the sidebar button, internal to that
    // module) own all three and these are deliberate no-ops.
    function openQuote(payload) {
        ensureRequestQuote()
            .then(() => { if (window.requestQuote) window.requestQuote.open(payload); })
            .catch(error => console.error(error));
    }

    document.addEventListener('click', (event) => {
        if (window.requestQuote) return;

        const quoteButton = event.target.closest && event.target.closest('button[data-policy="quote"]');
        if (quoteButton) {
            event.preventDefault();
            openQuote(undefined);
            return;
        }

        const priceButton = event.target.closest && event.target.closest('.request-price-btn');
        if (priceButton) {
            const article = priceButton.closest('article[data-product-id]');
            const productId = article ? article.getAttribute('data-product-id') : null;
            event.preventDefault();
            openQuote(productId ? { items: [{ product_id: productId, quantity: 1 }] } : undefined);
        }
    }, true);

    // The header "Get a Quote" link (every page but this one) arrives as
    // /store/store.html#quote. request-quote-module.js's own attach() reads
    // the hash and opens itself once it is loaded; this only has to make
    // sure loading starts without waiting for a click that will never come
    // on this page load.
    if (window.location.hash === '#quote') ensureRequestQuote().catch(error => console.error(error));

    // store-route-context-module.js's own product-detail deep link
    // (?product=<id>) needs the same readiness check before it can call
    // window.productDetails.open() — exposed here rather than duplicated.
    window.storeLazyOverlays = { ensureProductDetails, ensureRequestQuote };
})();
