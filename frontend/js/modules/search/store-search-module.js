/**
 * store-search-module.js
 *
 * The store's search box, which until now was markup and nothing else: an
 * `<input>` with no id, no class and no reference anywhere in the repository.
 * It promised "Search products, categories, or sets…" and did not search.
 *
 * WHY THE RESULTS ARE AN OVERLAY
 * ------------------------------
 * The obvious move is to repaint #dynamic-view with the matches. It is the
 * wrong one, for the reason request-quote-module.js gives for the same choice:
 * the section behind the search box is the page the visitor actually wanted,
 * and destroying it means that clearing the search has to rebuild it.
 *
 * This page cannot rebuild it. The home view's bundle slider binds
 * `#bundle-prev` / `#bundle-next` at DOMContentLoaded, so restoring the markup
 * from a string would hand back buttons with no handlers; and re-clicking the
 * gold `.nav-btn` to re-render would *navigate* when that button is "home",
 * which assigns window.location. An overlay touches none of it. Closing it
 * reveals the exact section, scroll position and filter state that were there,
 * because they never went anywhere.
 *
 * It also means no sidebar gold-state dance: searching is not a nav button, so
 * there is nothing to capture and restore the way the quote overlay must.
 *
 * TYPING CONTINUES INSIDE
 * -----------------------
 * Opening a takeover under someone's fingers and leaving focus behind it would
 * swallow the rest of what they were typing. So the overlay carries its own
 * search field, opened pre-filled with the query and focused with the caret at
 * the end — the visitor cannot tell that the field they are typing into is not
 * the one they started in.
 *
 * DATA
 * ----
 * `loadProducts()` and `loadCategories()` — the same two cached promises every
 * other surface reads, so searching after browsing costs no request. Results
 * are drawn with `window.productSection.card()`, which is what makes their
 * add-to-cart buttons work without this file knowing a cart exists.
 *
 * WHAT IT MATCHES
 * ---------------
 * Name, description, featured description and category name, because the
 * placeholder promises products *and* categories. Ranked so that a name match
 * beats a category match beats a description match: someone typing "underpinner"
 * wants the underpinner, not everything whose blurb mentions one.
 *
 * LOAD ORDER
 * ----------
 * After product-section-shared-module.js and store-overlay-shared-module.js.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.storeSearch) return;

    const section = window.productSection;
    if (!section) {
        console.error('store-search-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('store-search-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml, card } = section;
    const { PRIMARY_BUTTON_CLASSES, SEARCH_ICON, centredMessageHTML, enhance } = chrome;

    const INPUT_ID = 'store-search';

    // The shared SHELL (max-w-3xl) is a reading column: right for the quote and
    // account forms, wrong here. Search results are a product grid, and three
    // cards inside 768px leaves each one ~208px wide — narrower than anything on
    // the shelf they came from, with the name wrapping to three lines. This is
    // the store's own max-w-7xl content width instead, so a result card reads at
    // roughly the size the same card has in All Products. Everything else the
    // overlay draws — the prompt, empty, loading and error states — is centred
    // prose and still comes through centredMessageHTML on the narrow SHELL,
    // which is why this is a local token and not a change to the shared one.
    const RESULTS_SHELL = 'w-full max-w-7xl mx-auto px-6 md:px-10 lg:px-12';

    // Two characters is where a query starts telling products apart in a
    // catalogue this size. One character matches nearly everything and would
    // open the overlay on the first keystroke of every word.
    const MIN_QUERY = 2;

    // Long enough that a touch-typist finishes a word first, short enough that
    // the results feel like a consequence of typing rather than a page load.
    const DEBOUNCE_MS = 200;

    let handle = null;
    let timer = null;
    let query = '';
    let token = 0;          // guards against an out-of-order render

    // ------------------------------------------------------------------
    // MATCHING
    // ------------------------------------------------------------------
    const NAME_EXACT = 100;
    const NAME_PREFIX = 60;
    const NAME_PARTIAL = 40;
    const CATEGORY = 20;
    const DESCRIPTION = 10;

    function scoreOf(product, needle) {
        const name = String(product.name || '').toLowerCase();
        const category = String(product.category_name || '').toLowerCase();
        const description = (String(product.description || '') + ' ' + String(product.featured_description || '')).toLowerCase();

        if (name === needle) return NAME_EXACT;
        if (name.startsWith(needle)) return NAME_PREFIX;
        if (name.includes(needle)) return NAME_PARTIAL;
        if (category.includes(needle)) return CATEGORY;
        if (description.includes(needle)) return DESCRIPTION;

        return 0;
    }

    function search(products, raw) {
        const needle = raw.trim().toLowerCase();
        if (needle.length < MIN_QUERY) return [];

        return products
            .map(product => ({ product, score: scoreOf(product, needle) }))
            .filter(entry => entry.score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return String(a.product.name || '').localeCompare(String(b.product.name || ''));
            })
            .map(entry => entry.product);
    }

    // ------------------------------------------------------------------
    // MARKUP
    // ------------------------------------------------------------------
    // The overlay's own field, styled as the store's search row already styles
    // the one on the page, so the takeover reads as the same control grown to
    // fill the screen.
    function headerHTML() {
        return [
            '<header class="shrink-0 bg-white border-b border-[#12170f]/10">',
            '    <div class="' + RESULTS_SHELL + ' py-5 md:py-6 flex items-center gap-4">',
            '        <div class="relative flex-1">',
            '            <span class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#12170f]/40 pointer-events-none">' + SEARCH_ICON + '</span>',
            '            <input autocomplete="srk-no-autofill" spellcheck="false" type="text" id="search-overlay-input"',
            '                   placeholder="Search products, categories, or sets..."',
            '                   class="w-full pl-12 pr-6 py-2.5 bg-white border border-[#12170f]/10 rounded-full focus:outline-none focus:ring-2 focus:ring-[#d4af37] transition-all text-sm text-[#12170f] placeholder:text-[#12170f]/40" />',
            '        </div>',
            '        <button type="button" id="search-close" class="store-icon ' + chrome.ICON_BUTTON_CLASSES + '" aria-label="Close search">',
            '            ' + chrome.CLOSE_ICON,
            '        </button>',
            '    </div>',
            '    <h2 id="search-title" class="sr-only">Search results</h2>',
            '</header>'
        ].join('\n');
    }

    function resultsHTML(matches, raw) {
        const count = matches.length;

        return [
            '<div class="' + RESULTS_SHELL + ' py-8">',
            '    <p class="text-sm text-[#1f271b]/60 mb-8">',
            '        <span class="font-bold text-[#12170f]">' + count + '</span> ' + (count === 1 ? 'result' : 'results') +
                     ' for “<span class="font-bold text-[#12170f]">' + escapeHtml(raw.trim()) + '</span>”',
            '    </p>',
            '    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">',
            '        ' + matches.map(card).join('\n'),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    function promptHTML() {
        return centredMessageHTML('<p class="text-[#1f271b]/50 font-semibold">Type at least ' + MIN_QUERY + ' characters to search the catalogue.</p>');
    }

    function loadingHTML() {
        return centredMessageHTML('<p class="text-[#1f271b]/50 font-semibold">Searching…</p>');
    }

    function errorHTML() {
        return centredMessageHTML('<p class="text-[#1f271b]/50 font-semibold">Could not load the catalogue. Check your connection and try again.</p>');
    }

    function emptyHTML(raw) {
        return centredMessageHTML([
            '<p class="text-[#1f271b]/50 font-semibold mb-3">Nothing matches “' + escapeHtml(raw.trim()) + '”.</p>',
            '<p class="text-sm text-[#1f271b]/50 max-w-md mx-auto mb-8">Try a shorter word, or a category name like “mouldings”. If we do not list what you need, ask us for it directly.</p>',
            '<button type="button" id="search-to-quote" class="' + PRIMARY_BUTTON_CLASSES + '">Request a Quote</button>'
        ].join('\n'));
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    async function render() {
        if (!handle) return;

        const raw = query;
        const mine = ++token;

        if (raw.trim().length < MIN_QUERY) {
            handle.body.innerHTML = promptHTML();
            return;
        }

        handle.body.innerHTML = loadingHTML();

        let products;
        try {
            products = await section.loadProducts();
        } catch (error) {
            console.error('Store search: could not load the catalogue.', error);
            if (handle && mine === token) handle.body.innerHTML = errorHTML();
            return;
        }

        // A slower earlier query must not paint over a faster later one, and the
        // overlay may have been closed entirely while the fetch was in flight.
        if (!handle || mine !== token) return;

        const matches = search(products, raw);

        if (!matches.length) {
            handle.body.innerHTML = emptyHTML(raw);

            const ask = handle.node.querySelector('#search-to-quote');
            if (ask) {
                ask.addEventListener('click', () => {
                    close();
                    if (window.requestQuote) window.requestQuote.open();
                });
            }
            return;
        }

        handle.body.innerHTML = resultsHTML(matches, raw);
        handle.body.scrollTop = 0;
        enhance(handle.body);
    }

    // ------------------------------------------------------------------
    // LIFECYCLE
    // ------------------------------------------------------------------
    function open(initial) {
        query = initial || '';

        if (handle) {
            syncField();
            render();
            return;
        }

        handle = chrome.openOverlay({
            id: 'search-overlay',
            titleId: 'search-title',
            closeId: 'search-close',
            header: headerHTML(),
            onClose: () => {
                handle = null;
                query = '';

                // The page's own field is cleared, so the store the visitor
                // comes back to is not sitting under a query that is no longer
                // showing anything.
                const input = document.getElementById(INPUT_ID);
                if (input) input.value = '';
            }
        });

        const field = handle.node.querySelector('#search-overlay-input');
        if (field) {
            field.value = query;
            field.focus({ preventScroll: true });

            // Caret at the end, not selecting what was typed: the next
            // keystroke has to continue the word, not replace it.
            const end = field.value.length;
            field.setSelectionRange(end, end);

            field.addEventListener('input', () => {
                query = field.value;
                schedule();
            });
        }

        render();
    }

    function syncField() {
        if (!handle) return;

        const field = handle.node.querySelector('#search-overlay-input');
        if (field && field.value !== query) field.value = query;
    }

    function close() {
        if (handle) handle.close();
    }

    function schedule() {
        window.clearTimeout(timer);
        timer = window.setTimeout(render, DEBOUNCE_MS);
    }

    // ------------------------------------------------------------------
    // TRIGGER
    // ------------------------------------------------------------------
    function attach() {
        const input = document.getElementById(INPUT_ID);
        if (!input) return;

        input.addEventListener('input', () => {
            const value = input.value;

            if (value.trim().length < MIN_QUERY) {
                // Deleting back below the threshold means the visitor is
                // abandoning the search, not narrowing it.
                if (handle) close();
                return;
            }

            window.clearTimeout(timer);
            timer = window.setTimeout(() => open(value), DEBOUNCE_MS);
        });

        // Enter opens immediately rather than waiting out the debounce, which
        // is what pressing it is for.
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;

            event.preventDefault();
            window.clearTimeout(timer);

            if (input.value.trim().length >= MIN_QUERY) open(input.value);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();

    window.storeSearch = { open, close, search };
})();
