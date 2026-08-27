/* =============================================================================
   map-consent-module.js — the map loads when the visitor asks for it
   =============================================================================

   WHAT THIS REPLACES
   ------------------
   Nine pages carried a Google Maps <iframe> that loaded on sight. An iframe is
   not a picture: the moment the page rendered, every visitor's browser opened a
   connection to Google carrying their IP address, their User-Agent, and
   Google's own cookies for that browser. Nobody asked for a map. It happened on
   the catalogue page, on the store, and on all six legal pages — including,
   with a straight face, the privacy policy.

   The map is genuinely useful — this is a factory with an address customers
   visit — so it is not removed. It is moved behind the click that asks for it.
   Before that click nothing leaves this origin; after it, the visitor has
   chosen, which is the whole difference.

   HOW
   ---
   The <iframe> is not in the served markup at all. It is built here, on click,
   from the address on the placeholder's own data attributes. "Not in the DOM"
   rather than "hidden" is load-bearing: a display:none iframe still loads its
   src, so hiding one would have changed nothing at all about what Google is
   told.

   The server's CSP grants frame-src to Google only on documents that actually
   contain a placeholder, and works that list out by reading the HTML at boot
   rather than being told — see the MAP_FRAME_PAGES block in server.js.

   NO PREFERENCE IS STORED. A stored "yes" is a decision made on one visit
   applied to every later one, which is the pattern this is correcting rather
   than a smaller version of it. One click per page is a small price and it
   keeps the choice where it belongs.
   ============================================================================= */

(function () {
    'use strict';

    const SELECTOR = '[data-map-embed]';

    // Same attributes the original iframe carried, minus
    // referrerpolicy="no-referrer-when-downgrade" — which sent the full page
    // URL to Google on any https->https navigation, i.e. always. no-referrer
    // says nothing at all, and the map does not need to know which page asked.
    function buildFrame(placeholder) {
        const frame = document.createElement('iframe');
        frame.src = placeholder.getAttribute('data-map-src');
        frame.title = placeholder.getAttribute('data-map-title') || 'Location map';
        frame.className = 'absolute inset-0 w-full h-full border-0 grayscale opacity-90 hover:grayscale-0 hover:opacity-100 transition-all duration-500';
        frame.setAttribute('loading', 'lazy');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        // An embedded map needs to paint and to be scrolled. It does not need
        // to run top-level navigation, open popups, read this page's storage,
        // or claim any of the capabilities Permissions-Policy already denies —
        // allow-scripts and allow-same-origin are what a Google embed requires
        // and nothing beyond them is granted.
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        frame.setAttribute('allow', "geolocation 'none'; camera 'none'; microphone 'none'");
        return frame;
    }

    function activate(placeholder) {
        if (placeholder.dataset.mapLoaded === 'true') return;
        placeholder.dataset.mapLoaded = 'true';

        const frame = buildFrame(placeholder);
        placeholder.innerHTML = '';
        placeholder.appendChild(frame);
    }

    function bind(placeholder) {
        if (placeholder.dataset.mapBound === 'true') return;
        placeholder.dataset.mapBound = 'true';

        const button = placeholder.querySelector('[data-map-load]');
        if (!button) return;

        button.addEventListener('click', function (event) {
            event.preventDefault();
            activate(placeholder);
        });
    }

    function start() {
        document.querySelectorAll(SELECTOR).forEach(bind);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
