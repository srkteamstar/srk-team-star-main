/**
 * product-card-and-filter-tab-module.js
 *
 * catalogue.html's product grid and category filter row — wired to the real
 * catalogue now, replacing four hardcoded category buckets of fabricated
 * products with a hierarchy-aware row exactly like the store's All Products
 * section builds, off the same two cached fetches every other product
 * surface on the site reads (`window.productSection.loadProducts()` /
 * `.loadCategories()`), so this page costs no extra request and can never
 * drift from what the store shows.
 *
 * WHAT THIS REPLACED
 * -------------------
 * A hardcoded `categories` object — four fixed peer buckets
 * (machinery/moulding/hardware/spare-parts) of fictional products — with no
 * API call anywhere on this page. The four hash values (`#machinery` etc.)
 * and the flat-tab shape were baked into markup that could not express a
 * parent/child relationship at all.
 *
 * WHY NOT product-section-shared-module.js's register() / card() / shellHTML()
 * ---------------------------------------------------------------------------
 * `register()` swaps the contents of store.html's `#dynamic-view` on a
 * `.nav-btn` click — a shell this page does not have and should not grow;
 * this is a standalone page, not a `#dynamic-view` section. `card()` renders
 * a Buy Now / cart-icon footer wired to `cart-module.js`, which this page
 * correctly does not load — reusing it would ship two dead buttons per card.
 * So this page reuses only the DATA layer (`loadProducts`, `loadCategories`,
 * `indexCategories`, `categoryFilterRow`, `resolveMainImage`, `SORTS`,
 * `SORT_OPTIONS`) and renders its own card and its own mount/render loop.
 *
 * THE FILTER ROW
 * ---------------
 * `categoryFilterRow()` (product-section-shared-module.js) is the exact
 * hierarchy-aware behaviour the store's All Products section uses — see that
 * module's own header for the "Common ▾" capsule explanation, and
 * all-products-section-loader-module.js for the original this was extracted
 * from. This page configures the factory with its own default tab name, its
 * own `<style>` id (so the two pages never share one `<style>` tag) and its
 * own tick colour (`#420c14`, this page's own accent — not the store's gold)
 * — everything else is identical code, not a second copy of it.
 *
 * HASH DEEP-LINKS
 * ----------------
 * The four legacy hashes (`#machinery #moulding #hardware #spare-parts`) are
 * linked from this page's own footer and from index.html's "What We Offer"
 * cards. Internal filter state stays keyed by category **id** — the same
 * id-based `rootOf`/`subtreeKeys` matching every other hierarchy-aware
 * surface on the site uses — so each rendered tab additionally carries a
 * `data-slug` pulled from the category's own `url_slug`, and an incoming
 * hash is matched against that, not against the id.
 *
 * For the four legacy hashes to keep resolving, the intended root
 * categories' `url_slug` values in the database need to read exactly
 * `machinery` / `moulding` / `hardware` / `spare-parts` — a content edit in
 * the category records, not something this file can enforce. An
 * unmatched hash falls through to the same default-by-name tab a fresh page
 * load opens on — the same graceful landing the old per-button
 * `data-category` matching already had for an unrecognised value.
 *
 * SORT
 * ----
 * The five `<option>`s in `catalogue.html`'s `#sort-by` are authored to
 * match `SORT_OPTIONS` (Newest / Oldest / Name A–Z / Name Z–A / Category),
 * replacing the old 3-option list whose "Type" sort depended on a fabricated
 * per-product field with no real equivalent. They are static markup rather
 * than JS-populated, deliberately: `custom-select-module.js` enhances every
 * `<select>` already in the document at `DOMContentLoaded`, which fires
 * before this module's own async catalogue fetch could ever resolve — a
 * JS-populated select would already have been enhanced (and rendered) empty
 * by the time real options arrived, with no way to refresh that trigger
 * afterward. `SORT_OPTIONS` is a fixed list, known at author time, so there
 * is nothing gained by generating it and a real race to lose by trying.
 *
 * PRICE
 * -----
 * Deliberately not shown on these cards — a page-level design choice, not a
 * technical limitation (the data is there). `price-format-module.js` is not
 * loaded on this page because nothing here needs it.
 *
 * OUT OF SCOPE
 * ------------
 * The asset-folder convention under `assets/products/<Product Name>/` is
 * untouched by this file. Images come from `resolveMainImage()` — the same
 * `product_images`-backed URLs the store shows — same as everywhere else the
 * real catalogue is rendered.
 *
 * LOAD ORDER
 * ----------
 * After general-scroll-reveal-module.js, custom-select-module.js (for the
 * capsule dropdown, self-enhancing) and product-section-shared-module.js
 * (new on this page). Before view-state-restore-module.js, which must stay
 * last — and which gained a bounded retry for this page's filter group,
 * since it no longer exists in the DOM at the DOMContentLoaded moment that
 * module used to check it at.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('product-card-and-filter-tab-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml, resolveMainImage, indexCategories, SORTS, SORT_OPTIONS, DEFAULT_SORT } = section;

    // See DEFAULT_TAB_NAME in all-products-section-loader-module.js for the
    // full reasoning — same "Machinery" the store's own filter row and
    // request-quote-module.js default to, for the same reason.
    const DEFAULT_TAB_NAME = 'machinery';

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    let allProducts = [];
    let filters = null;   // { html, match, init } from categoryFilterRow(), rebuilt once per load

    // ------------------------------------------------------------------
    // CARD
    // ------------------------------------------------------------------
    // A new, catalogue-specific card, not section.card() — see the file
    // header for why. An <a>, not a <div onclick>, for the same reason the
    // cart drawer's checkout button is one: this is a navigation, so it
    // should middle-click and open in a new tab like any other link. No
    // The product id is carried into the store so the exact item opens there.
    function card(product) {
        const name = escapeHtml(product.name);
        const category = escapeHtml(product.category_name || '');
        const description = (product.description || '').trim();
        const imageUrl = resolveMainImage(product);

        // Same 404-safe swap product-section-shared-module.js's own card
        // uses: the name stand-in stays hidden behind a loaded image and only
        // shows if the URL actually fails, never through one.
        const media = imageUrl
            ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + name + '" loading="lazy"' +
              ' class="w-full h-full object-contain mix-blend-multiply"' +
              ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
              '\n<div class="absolute inset-6 items-center justify-center text-center text-[#12170f]/30 text-sm font-semibold px-2" style="display:none">' + name + '</div>'
            : '<div class="absolute inset-6 flex items-center justify-center text-center text-[#12170f]/30 text-sm font-semibold px-2">' + name + '</div>';

        return [
            '<a href="/store/store.html?product=' + encodeURIComponent(product.id) + '#all-products" class="product-info flex flex-col bg-white border border-[#12170f]/10 rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:scale-[101%] transition-all duration-300 h-full group">',
            '    <div class="relative w-full h-56 bg-gray-50/50 flex items-center justify-center p-6 overflow-hidden">',
            category
                ? '        <span class="product-title absolute top-3 left-3 bg-[#f1f5f9] text-[#1f271b] text-xs font-semibold px-2.5 py-1 rounded shadow-sm border border-black/5 z-10 uppercase tracking-wide">' + category + '</span>'
                : '',
            '        ' + media,
            '    </div>',
            '    <div class="flex flex-col flex-1 p-5">',
            '        <h3 class="product-heading text-lg lg:text-xl font-bold leading-[1.2] text-[#12170f] tracking-tight mb-2">' + name + '</h3>',
            description
                // Clamped to 4 lines: unclamped, a long real description (most
                // of them run several paragraphs) made every card a different
                // height and the grid read as broken rather than varied.
                ? '        <p class="product-description text-xs text-[#1f271b]/70 leading-relaxed mb-4 line-clamp-4">' + escapeHtml(description) + '</p>'
                : '        <p class="product-description text-xs text-[#1f271b]/40 leading-relaxed mb-4 italic">No description added.</p>',
            '        <div class="cta-action-bar mt-auto pt-3 border-t border-[#12170f]/5">',
            '            <div class="product-cta w-full inline-flex items-center justify-center bg-[#d4af37] text-white text-sm font-medium px-4 py-2.5 rounded group-hover:bg-[#c09f32] transition-colors">',
            '                Shop in Store',
            '                <svg class="w-3.5 h-3.5 ml-2 stroke-white" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>',
            '            </div>',
            '        </div>',
            '    </div>',
            '</a>'
        ].filter(line => line !== '').join('\n');
    }

    // ------------------------------------------------------------------
    // STATES
    // ------------------------------------------------------------------
    function loadingHTML() {
        return '<p class="col-span-full text-center text-[#1f271b]/40 py-10">Loading the catalogue…</p>';
    }

    function errorHTML() {
        return [
            '<div class="col-span-full text-center py-10">',
            '    <p class="text-[#1f271b]/50 font-semibold mb-4">Could not load the catalogue. Check your connection and try again.</p>',
            '    <button type="button" id="catalogue-retry" class="text-sm font-bold text-[#420c14] hover:underline">Retry</button>',
            '</div>'
        ].join('\n');
    }

    function emptyHTML() {
        return '<p class="col-span-full text-center text-gray-500 py-10">No products found in this category.</p>';
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    function render() {
        const container = document.querySelector('.product-container');
        const sortSelect = document.getElementById('sort-by');
        if (!container || !filters) return;

        const match = filters.match;
        const compare = SORTS[sortSelect ? sortSelect.value : DEFAULT_SORT] || SORTS[DEFAULT_SORT];

        // position preserves the API's own order as a stable tie-break, same
        // as product-section-shared-module.js's own render loop — equal keys
        // must not reshuffle between renders.
        const visible = allProducts
            .filter(match)
            .map((product, position) => ({ product, position }));

        visible.sort((a, b) => compare(a.product, b.product) || a.position - b.position);

        if (!visible.length) {
            container.innerHTML = emptyHTML();
            return;
        }

        container.innerHTML = visible.map(entry => card(entry.product)).join('\n');
    }

    // ------------------------------------------------------------------
    // HASH ROUTING
    // ------------------------------------------------------------------
    // Internal state stays keyed by category id (categoryFilterRow's own
    // match() logic is id-based, same as every hierarchy-aware surface on
    // the site); data-slug exists purely for this page's own hash contract
    // — the filter row itself knows nothing about hashes. See the file
    // header for what has to be true in the database for the four legacy
    // hashes to keep resolving.
    // A hash names a category the way a person writes it, and the database
    // spells it the way an admin typed it. Those two drift, and when they do
    // the visitor is not told — the link resolves to nothing and the page
    // opens on its default tab, which looks exactly like a working link to a
    // category that happens to be empty.
    //
    // It is drifting today. This site's own footer, About page and home page
    // all link `#moulding`; the live root category's `url_slug` reads
    // `moldings`. Every one of those links has been quietly landing on
    // Machinery. `#spare-parts` has the same shape of problem from the other
    // direction — no root slug matches it, while a root category plainly
    // called "Machine Spare Parts" is sitting right there.
    //
    // Correcting the slugs in the category records is still the right fix
    // and this does not replace it. What it does is stop a content edit being
    // load-bearing for links that are already published and cannot be
    // recalled: the exact slug still wins, and three progressively looser
    // matches stand behind it.
    //
    //   1. exact `url_slug`                    moldings   -> moldings
    //   2. normalised slug                     moulding   -> moldings
    //   3. normalised category name            hardware   -> Hardware & Accessories
    //   4. name contains the request           spare-parts-> Machine Spare Parts
    //
    // Normalising folds case, punctuation, a trailing plural and the British
    // "ou" that this site writes and the database does not (moulding/molding,
    // colour/color) — a spelling rule, not a lookup table, so it keeps working
    // for a category nobody has thought of yet.
    //
    // Step 4 is only allowed to answer when EXACTLY ONE tab matches. An
    // ambiguous request falls through to the default tab, which is the same
    // graceful landing an unrecognised hash has always had — guessing between
    // two categories would be worse than not guessing.
    function normaliseSlug(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ou/g, 'o')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/s(-|$)/g, '$1');
    }

    function tabForHash() {
        const requested = decodeURIComponent(window.location.hash.slice(1)).trim();
        if (!requested) return null;

        const exact = document.querySelector('.category-btn[data-slug="' + CSS.escape(requested) + '"]');
        if (exact) return exact;

        const wanted = normaliseSlug(requested);
        if (!wanted) return null;

        const tabs = [...document.querySelectorAll('.category-btn')];

        const bySlug = tabs.find(btn => normaliseSlug(btn.dataset.slug) === wanted);
        if (bySlug) return bySlug;

        const byName = tabs.find(btn => normaliseSlug(btn.dataset.slugName) === wanted);
        if (byName) return byName;

        const contained = tabs.filter(btn => {
            const name = normaliseSlug(btn.dataset.slugName);
            return name && name !== wanted && ('-' + name + '-').indexOf('-' + wanted + '-') !== -1;
        });

        return contained.length === 1 ? contained[0] : null;
    }

    // The click is replayed rather than state assigned directly, for the
    // same reason view-state-restore-module.js replays: the button's own
    // handler (built by categoryFilterRow) is the only thing that puts the
    // row in a state it agrees with — capsule selects included.
    function routeHash() {
        const btn = tabForHash();
        if (btn) btn.click();
    }

    // ------------------------------------------------------------------
    // BOOT
    // ------------------------------------------------------------------
    async function init() {
        const filterRow = document.getElementById('category-filters');
        const sortSelect = document.getElementById('sort-by');
        const container = document.querySelector('.product-container');
        if (!filterRow || !sortSelect || !container) return;

        // This page writes the Filter / Sort by toolbar into its own static
        // markup (the sort <select> has to exist before custom-select-module.js
        // enhances it), so it asks for the stylesheet that paints the two
        // labels rather than getting it for free from shellHTML().
        if (typeof section.ensureToolbarStyles === 'function') section.ensureToolbarStyles();

        container.innerHTML = loadingHTML();

        let products;
        let categories;
        try {
            [products, categories] = await Promise.all([section.loadProducts(), section.loadCategories()]);
        } catch (error) {
            console.error('Catalogue: could not load the catalogue.', error);
            container.innerHTML = errorHTML();

            const retry = document.getElementById('catalogue-retry');
            if (retry) retry.addEventListener('click', init);
            return;
        }

        allProducts = products;

        const index = indexCategories(categories);

        const factory = section.categoryFilterRow({
            defaultTabName: DEFAULT_TAB_NAME,
            styleId: 'catalogue-filter-styles',
            tickColor: '#420c14',
            // Unlike All Products, every active root category gets a tab
            // here, whether or not a product is filed under it yet — by
            // request. A childless, productless root (Hardware & Accessories,
            // Photo Frame Moldings — both active, neither has products or
            // sub-categories today) still gets a plain pill; clicking it
            // shows the honest "No products found" state rather than never
            // appearing in the row at all.
            allCategories: true
        });
        filters = factory(allProducts, index);

        filterRow.innerHTML = filters.html;

        // custom-select-module.js's own mutation observer would pick these up
        // a tick later, long enough for the raw native dropdown to flash —
        // the same reason product-section-shared-module.js's open() enhances
        // synchronously rather than waiting for it. Enhancing now also
        // guarantees the trigger exists by the time filters.init() looks for
        // it, below.
        if (typeof window.enhanceCustomSelects === 'function') window.enhanceCustomSelects(filterRow);

        // Slugs are for THIS page's hash routing only — categoryFilterRow
        // doesn't know this page has a hash contract, and no other
        // hierarchy-aware surface needs one.
        const slugById = new Map();
        const nameById = new Map();
        (Array.isArray(categories) ? categories : []).forEach(c => {
            slugById.set(String(c.id), c.url_slug || '');
            nameById.set(String(c.id), c.name || '');
        });

        [...filterRow.querySelectorAll('.category-btn')].forEach(btn => {
            const slug = slugById.get(btn.dataset.category);
            if (slug) btn.dataset.slug = slug;

            // The name is the second thing a hash can be matched against when
            // the slug does not answer — see tabForHash(). Carried on the
            // element for the same reason the slug is: this page's hash
            // contract is its own, and categoryFilterRow knows nothing of it.
            const name = nameById.get(btn.dataset.category);
            if (name) btn.dataset.slugName = name;
        });

        filters.init(filterRow, render);
        sortSelect.addEventListener('change', render);

        // The footer sits on this page too, so its Shop column can change the
        // hash without a load. Re-routing on hashchange also gives Back its
        // meaning: it walks the tabs in reverse rather than leaving a stale
        // grid behind.
        window.addEventListener('hashchange', routeHash);

        // A matched hash replays its tab's own click — but categoryFilterRow's
        // own choose() is a no-op when the clicked tab is already the active
        // one (it exists to stop re-picking the current tab from doing
        // pointless work), so a hash that happens to name the *default* tab
        // (#machinery, matching the row's own default) triggers no repaint at
        // all and the page would sit on "Loading the catalogue…" forever.
        // render() is therefore called unconditionally — redundant, not
        // wrong, on the rare case the click *did* already repaint.
        const btn = tabForHash();
        if (btn) btn.click();
        render();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
