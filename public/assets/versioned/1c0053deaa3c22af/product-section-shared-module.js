/**
 * product-section-shared-module.js
 *
 * The parts every store product section has in common: the catalogue fetch, the
 * card, the sort control, and the loading / empty / error states.
 *
 * The store's four product views — All Products, Featured, Best Sellers and New
 * Arrivals — differ in exactly two ways: which products they show, and whether
 * they carry a filter row. Everything else is identical, and used to be four
 * hand-maintained copies of the same card markup, which is how three of them
 * ended up still rendering a hardcoded array long after the catalogue went live.
 * This file owns the shared half; each section file declares only its own rule.
 *
 *     window.productSection.register({
 *         policy:       'featured',                 // the nav button's data-policy
 *         wrapperId:    'dynamic-featured-wrapper',
 *         title:        'Featured Products',
 *         emptyMessage: 'No featured products yet. Check back soon.',
 *         select:       (products) => products.filter(p => p.is_featured === true)
 *     });
 *
 * `select` receives the full active catalogue plus the category tree and returns
 * the subset to show. A section that also needs a filter row passes `filters`
 * (see all-products-section-loader-module.js, the only one that does).
 *
 * A section can also put a short row on the store home page — a heading, a
 * "View All" link, and the first few products — by declaring one from the same
 * file, so the row and the section it links to share one `select` and cannot
 * disagree about what qualifies:
 *
 *     window.productSection.registerPreview({
 *         hostId: 'new-arrivals-preview',
 *         gridId: 'new-arrivals-preview-grid',
 *         title:  'New Arrivals',
 *         select: sameFunctionTheSectionUses
 *     });
 *
 * DATA
 * ----
 * GET /api/products/public returns active products and customer-facing fields
 * only; GET /api/categories/public returns active categories with `parent_id`.
 * Both are fetched once per page load and shared across every section, so moving
 * between them never refetches or flashes a spinner. A reload gets fresh data,
 * as does Retry after a failure.
 *
 * PLACEMENT TAG
 * -------------
 * A product can carry several placement flags at once. The badge shows one, by
 * the priority in PLACEMENTS below: Best Seller, then New Arrival, then
 * Featured. So a product flagged best seller *and* new arrival reads "Best
 * Seller", and either of those outranks Featured. This holds in every section —
 * a card in Featured can read "Best Seller", because the badge describes the
 * product, not the shelf it is standing on.
 *
 * MAIN IMAGE
 * ----------
 * A product holds up to four images and one of them is marked main. The card
 * shows that one. `image_url` from the API is already the main image resolved
 * server-side; resolveMainImage() re-derives it from the `images` array first
 * so the rule lives visibly here too, and falls back through image_url and then
 * the lowest slot for a product whose main flag was never set.
 *
 * WHY THE GRID PAGES ITSELF RATHER THAN THE FETCH
 * ------------------------------------------------
 * Search/filter/sort all run client-side, over the section's own `selected`
 * array, and none of them can narrow a set they have not been handed yet —
 * so the paginated fetch in fetchAllProductPages() still resolves the WHOLE
 * matching set before anything filters or sorts it; a partial catalogue
 * would make "no matches" and "not loaded yet" indistinguishable. What DOES
 * block first paint at scale is turning every matching product into markup
 * and inserting all of it in one synchronous innerHTML write. render() (in
 * open(), below) only ever builds PAGE_SIZE cards at a time and appends more
 * behind an accessible "Load more" button, moreControlHTML(); a catalogue
 * small enough to fit in one batch — every section's, today — never shows
 * the control at all, so this changes nothing about how the site looks now.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.productSection) return;

    const PRODUCTS_URL = '/api/products/public';
    const CATEGORIES_URL = '/api/categories/public';

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Priority order — first match wins. See the note in the file header.
    const PLACEMENTS = [
        { flag: 'is_best_seller', label: 'Best Seller', classes: 'bg-[#420c14] text-white' },
        { flag: 'is_new_arrival', label: 'New Arrival', classes: 'bg-[#2a3424] text-white' },
        { flag: 'is_featured',    label: 'Featured',    classes: 'bg-[#d4af37] text-[#12170f]' }
    ];

    function placementFor(product) {
        return PLACEMENTS.find(placement => product[placement.flag] === true) || null;
    }

    // The image marked as main, with two fallbacks so a product whose
    // main flag was never set still shows a picture instead of a blank panel.
    function resolveMainImage(product) {
        const images = Array.isArray(product.images) ? product.images : [];

        const main = images.find(image => image.is_main === true);
        if (main && main.url) return main.url;

        if (product.image_url) return product.image_url;

        const lowest = images
            .filter(image => image && image.url)
            .sort((a, b) => (a.slot || 0) - (b.slot || 0))[0];

        return lowest ? lowest.url : '';
    }

    // price-format-module.js owns how a price reads, so every surface and the
    // storefront can never drift. It is loaded after this file but only ever
    // called at render time, by which point every module script has run.
    function formatPrice(value) {
        if (typeof window.formatProductPrice === 'function') return window.formatProductPrice(value);
        return value == null ? '' : String(value);
    }

    // Products whose category was deleted keep a null category_id. They stay
    // visible under "All" rather than vanishing, and simply have no tab.
    const UNCATEGORISED = '__none__';

    function categoryKey(product) {
        const id = product.category_id;
        return (id === null || id === undefined || id === '') ? UNCATEGORISED : String(id);
    }

    // ------------------------------------------------------------------
    // CATEGORY TREE
    // ------------------------------------------------------------------
    // Ids are compared as strings throughout: they arrive as numbers from the
    // API but as strings once they have been through a data-attribute or an
    // <option value>, and a single loose comparison left in would quietly break
    // a filter.
    function indexCategories(categories) {
        const byId = new Map();
        const children = new Map();

        (Array.isArray(categories) ? categories : []).forEach(category => {
            const id = String(category.id);
            const parent = category.parent_id;

            byId.set(id, {
                id,
                name: category.name || ('Category ' + id),
                parentId: (parent === null || parent === undefined || parent === '') ? null : String(parent)
            });
        });

        // A deactivated parent is absent from the public response. Its children
        // are still active, so they read as top level rather than disappearing
        // into a tab that was never rendered.
        byId.forEach(entry => {
            if (entry.parentId && !byId.has(entry.parentId)) entry.parentId = null;
        });

        byId.forEach(entry => {
            if (!entry.parentId) return;
            if (!children.has(entry.parentId)) children.set(entry.parentId, []);
            children.get(entry.parentId).push(entry);
        });

        children.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));

        return { byId, children };
    }

    // Walks up to the top of the tree. `seen` guards against a parent_id cycle,
    // which the table's self-reference check alone does not rule out (A → B → A
    // passes it) and which would otherwise hang the page.
    function rootOf(index, key) {
        let current = index.byId.get(key);
        if (!current) return key;

        const seen = new Set();
        while (current.parentId && !seen.has(current.id)) {
            seen.add(current.id);
            const parent = index.byId.get(current.parentId);
            if (!parent) break;
            current = parent;
        }

        return current.id;
    }

    // A category and everything filed underneath it, so picking "Blades" also
    // shows whatever sits in a sub-category of Blades.
    function subtreeKeys(index, key) {
        const keys = new Set();
        const queue = [key];

        while (queue.length) {
            const id = queue.shift();
            if (keys.has(id)) continue;
            keys.add(id);
            (index.children.get(id) || []).forEach(child => queue.push(child.id));
        }

        return keys;
    }

    // ------------------------------------------------------------------
    // SORTING
    // ------------------------------------------------------------------
    const productName = (product) => String(product.name || '');

    // U+FFFF sorts after any real name, so uncategorised products land at the
    // end of a category sort rather than at the front of it.
    const productCategory = (product) => String(product.category_name || '￿');

    // null, not 0, for a row with no usable date: 0 is 1970 and would head the
    // "Oldest" list. Undated rows belong at the end of both directions.
    function productTime(product) {
        const parsed = Date.parse(product.created_at || '');
        return Number.isNaN(parsed) ? null : parsed;
    }

    function byTime(a, b, direction) {
        const left = productTime(a);
        const right = productTime(b);

        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;

        return (left - right) * direction;
    }

    const SORTS = {
        'newest':    (a, b) => byTime(a, b, -1),
        'oldest':    (a, b) => byTime(a, b, 1),
        'name-asc':  (a, b) => productName(a).localeCompare(productName(b)),
        'name-desc': (a, b) => productName(b).localeCompare(productName(a)),
        'category':  (a, b) => productCategory(a).localeCompare(productCategory(b))
                            || productName(a).localeCompare(productName(b))
    };

    const SORT_OPTIONS = [
        { value: 'newest',    label: 'Newest' },
        { value: 'oldest',    label: 'Oldest' },
        { value: 'name-asc',  label: 'Name (A–Z)' },
        { value: 'name-desc', label: 'Name (Z–A)' },
        { value: 'category',  label: 'Category' }
    ];

    const DEFAULT_SORT = 'newest';

    // How many cards render() paints into the DOM before it stops and waits
    // for "Load more" — not how many products the fetch asks for. Every
    // section still resolves the WHOLE matching set in one request (see
    // loadProducts() below), because search/filter/sort here run entirely in
    // the browser and cannot narrow a set they have not seen yet. What this
    // caps is the other half of "wait for everything before the customer
    // sees anything": building and inserting a card per matching product,
    // synchronously, in one innerHTML write. A catalogue small enough to fit
    // in one batch (true of every section today) never shows the control at
    // all — see moreControlHTML().
    const PAGE_SIZE = 24;

    // Newest first with a name tie-break, for the sections that have to pick a
    // fixed number of products rather than order the ones they were handed.
    // Without the tie-break, two products saved in the same second would swap
    // places between page loads and the section would look unstable.
    const newestFirst = (a, b) => SORTS.newest(a, b) || productName(a).localeCompare(productName(b));

    // ------------------------------------------------------------------
    // MARKUP
    // ------------------------------------------------------------------
    // ---------------------------------------------------------------- pricing
    // Does this product carry a price a customer could actually be charged?
    //
    // This is the one question that decides which controls a card offers, and
    // it has to give the same answer the server does. `products.price` is a
    // `text` column where "On request" is a legal value — 43 of 48 live rows
    // today — so "has a price" is a parse, not a null check.
    //
    // priceCheckout() in server.js runs the identical test and answers an
    // unpriced line with `reason: 'on_request'`. Reading the same rule here is
    // what stops a card offering a purchase the checkout route is bound to
    // refuse two screens later: before this existed, Buy Now sat on every
    // card, and pressing it on an "On request" product added the line, walked
    // the customer to checkout, and was met with "These need a quote."
    //
    // window.parseProductPrice is price-format-module.js's, which is the file
    // that owns what counts as a number anywhere on this site.
    function isPurchasable(product) {
        const parse = window.parseProductPrice;

        // price-format-module.js is loaded AFTER this file on store.html.
        // card() only ever runs at render time — long after both have
        // evaluated — but a page that somehow painted earlier must fail
        // towards "no price" rather than towards offering a broken purchase.
        if (typeof parse !== 'function') {
            const raw = String(product && product.price != null ? product.price : '')
                .trim().replace(/,/g, '');
            return raw !== '' && /^\d+(\.\d+)?$/.test(raw);
        }

        return parse(product ? product.price : null) !== null;
    }

    function card(product) {
        const name = escapeHtml(product.name);
        const placement = placementFor(product);
        const imageUrl = resolveMainImage(product);
        const description = (product.description || '').trim() ||
            String(product.name || 'This product') + ' is listed in our ' + String(product.category_name || 'frame-making') + ' range. Contact us to confirm specifications and compatibility.';
        const productHref = '/products/' + encodeURIComponent(product.url_slug || String(product.id));
        const purchasable = isPurchasable(product);

        // Plenty of live rows carry no price yet. An empty slot would collapse
        // the card's layout and read as a rendering bug, so it says so instead —
        // and "on request" is the honest answer for B2B machinery anyway.
        const price = formatPrice(product.price) || 'Price on request';

        const badge = placement
            ? '<span class="absolute top-3 left-3 ' + placement.classes + ' text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-wider z-10">' + placement.label + '</span>'
            : '';

        // A URL that 404s reveals the product name instead of an empty grey box.
        // No external placeholder service — an offline CDN would break the grid.
        //
        // The name stand-in stays hidden behind a loaded image and is only
        // revealed if the URL fails — it must never show *through* one. The
        // image is object-contain over a transparent area and blends with what
        // is under it, so a stand-in left visible reads as a watermark across
        // the product photo. Same swap featured-hero-loader.js uses.
        const media = imageUrl
            ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + name + '" loading="lazy"' +
              ' class="w-full h-full object-contain mix-blend-multiply"' +
              ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
              '\n<div class="absolute inset-6 items-center justify-center text-center text-[#12170f]/30 text-sm font-semibold px-2" style="display:none">' + name + '</div>'
            : '<div class="absolute inset-6 flex items-center justify-center text-center text-[#12170f]/30 text-sm font-semibold px-2">' + name + '</div>';

        return [
            // Real links expose public product pages to crawlers and new tabs;
            // ordinary clicks retain the existing in-store details overlay.
            '<article data-product-id="' + escapeHtml(product.id) + '" data-product-slug="' + escapeHtml(product.url_slug) + '"',
            '         class="group flex flex-col bg-white border border-[#12170f]/10 rounded-sm overflow-hidden hover:shadow-xl hover:scale-[101%] transition-all duration-300 h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2">',
            '    <a href="' + escapeHtml(productHref) + '" data-product-link aria-label="View details for ' + name + '" class="relative w-full h-[200px] shrink-0 bg-[#f1f5f9] flex items-center justify-center p-6 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#705714] focus-visible:ring-inset">',
            '        ' + badge,
            '        ' + media,
            '    </a>',
            '    <div class="flex flex-col flex-1 p-5">',
            '        <h3 class="font-bold text-[#1f271b] text-lg mb-1 leading-snug line-clamp-2"><a href="' + escapeHtml(productHref) + '" data-product-link>' + name + '</a></h3>',
            description
                ? '        <p class="text-sm text-[#1f271b]/70 truncate mb-3">' + escapeHtml(description) + '</p>'
                : '        <p class="text-sm text-[#1f271b]/40 truncate mb-3 italic">No description added.</p>',
            '        <span class="text-lg font-bold text-[#12170f] mt-auto mb-4 block">' + escapeHtml(price) + '</span>',
            '        <div class="pt-4 flex items-center justify-between border-t border-[#12170f]/5 gap-3">',
            // A priced product keeps both controls exactly as they were. An
            // unpriced one gets ONE, because neither of these can succeed for
            // it: the cart would hold a line with no amount, and Buy Now would
            // walk the customer into a checkout that refuses the whole order.
            purchasable
                // A <button>, not the <span> this used to be. It is the gold call to
                // action on the card and the thing a customer is most likely to
                // press, so it has to be reachable by keyboard and announce itself
                // as a control. cart-module.js picks it up by class and adds the
                // product, then continues to checkout — "Buy Now" is the whole intent,
                // where the small icon beside it is a quiet add.
                ? '            <button type="button" class="buy-now-btn flex-1 min-w-0 bg-[#d4af37] text-white text-sm font-bold px-4 py-2.5 rounded-sm hover:bg-[#c09f32] transition-colors text-center truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2" aria-label="Add ' + name + ' to cart and continue to checkout">Buy Now</button>\n' +
                  // The icon takes its colour from the button through `currentColor`,
                  // so one hover rule flips both. It used to rely on a `group/btn`
                  // variant that left the glyph dark-on-dark once the button filled in.
                  //
                  // The click is handled by cart-module.js through one delegated
                  // listener on the document — these cards are re-rendered wholesale
                  // on every section change, so nothing may be bound per button.
                  '            <button type="button" class="cart-icon-btn shrink-0 w-10 h-10 bg-[#f1f5f9] text-[#12170f] rounded-sm flex items-center justify-center border border-transparent outline-none hover:bg-[#12170f] hover:text-white hover:border-white focus-visible:ring-2 focus-visible:ring-[#d4af37] transition-all duration-300" aria-label="Add ' + name + ' to cart">\n' +
                  '                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n' +
                  '                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9zm7 4v4m-2-2h4"></path>\n' +
                  '                </svg>\n' +
                  '            </button>'
                // Full width, and gold, because it is now the only call to
                // action on the card rather than the quiet half of a pair.
                // request-quote-module.js picks it up by class through its own
                // delegated listener and opens the quote form already carrying
                // this product — the same handoff the cart drawer and the
                // details overlay use, so the customer never re-picks what
                // they just clicked.
                : '            <button type="button" class="request-price-btn w-full bg-[#d4af37] text-white text-sm font-bold px-4 py-2.5 rounded-sm hover:bg-[#c09f32] transition-colors text-center truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2" aria-label="Request a price for ' + name + '">Request a price</button>',
            '        </div>',
            '    </div>',
            '</article>'
        ].join('\n');
    }

    // ---------------------------------------------------------------- toolbar
    // The row above a product grid holds two controls that do completely
    // different jobs, and it used to name neither of them: a run of category
    // pills, then an unlabelled "Newest" dropdown. Two things followed.
    //
    // Nothing said which control narrowed the grid and which reordered it --
    // the sort read as one more category pill. And the whole row was one
    // `overflow-x-auto` box, so on a phone the sort control was pushed off the
    // right-hand end by the pills and had to be scrolled to blind. It was
    // reachable and effectively invisible.
    //
    // So the row is two named groups, Filter and Sort by, and only the pills
    // scroll: the sort keeps its own cell and stays on screen at every width.
    // Below `sm` the groups stack, sort under filter.
    //
    // The labels are painted by these rules rather than by Tailwind utilities
    // because every page's inline <style> opens with a universal rule setting
    // `color` and `font-weight` on every element, and a direct match beats an
    // inherited one -- the same trap the card icons and the capsule tick answer.
    const TOOLBAR_STYLE_ID = 'product-section-toolbar-styles';
    // Grid, not flex, and `minmax(0,1fr)` rather than a plain `1fr` -- this is
    // load-bearing and was measured, not guessed. As a flex row the pill track
    // would not shrink: `min-width:0` lets a flex item shrink once its
    // container is already narrower than its contents, but it does not stop
    // that item's *intrinsic* width propagating outward, and the store's shell
    // sizes `#store-content` from exactly that. The pills' natural 836px was
    // pushing the whole store page 139px wider than the viewport, which put the
    // sort control (and a third of the product grid) off the right-hand edge --
    // the same disappearance this toolbar exists to fix, moved up a level.
    // A `minmax(0,1fr)` track is capped at 0 for intrinsic sizing, so the pill
    // row can never widen its ancestors and scrolls inside its track instead.
    // The single-column form below `sm` is a grid for the same reason.
    const TOOLBAR_CSS = [
        '.srk-toolbar{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;width:100%;}',
        // The gap is wider than it looks like it needs to be: at narrow desktop
        // widths the pill track clips mid-pill, and a half-drawn pill touching
        // the "Sort by" label reads as a rendering fault rather than as an
        // edge you can scroll.
        '@media (min-width:640px){.srk-toolbar{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:1.5rem;}}',

        '.srk-toolbar__group{display:flex;align-items:center;gap:.75rem;min-width:0;}',
        // Stacked on a phone, both groups start at the same left edge: the
        // sort control used to sit alone against the right margin, which read
        // as a stray control rather than as the second half of a pair. It goes
        // back to the right only at 640px, where the two sit side by side and
        // the row genuinely has two ends.
        '.srk-toolbar__group--sort{flex:none;justify-content:flex-start;}',
        '@media (min-width:640px){.srk-toolbar__group--sort{justify-content:flex-end;}}',

        // With both stacked and left-aligned, the two labels are different
        // widths ("Filter" vs "Sort by") and the controls beside them would
        // start at two different x positions -- close enough to look like a
        // mistake rather than a difference. A shared minimum on the label
        // lines the pills and the sort trigger up in one column. Dropped at
        // 640px, where the groups are at opposite ends and nothing lines up
        // with anything anyway.
        '@media (max-width:639px){.srk-toolbar__label{min-width:3.5rem;}}',

        '.srk-toolbar__label{flex:none;font-size:.6875rem;font-weight:700;letter-spacing:.12em;',
        'text-transform:uppercase;color:rgba(18,23,15,.45);white-space:nowrap;}',

        // Only the pills scroll. The scrollbar is hidden the same way the
        // store's own `.no-scrollbar` does it, kept here so the rule travels
        // with the markup to catalogue.html, which never defined that class.
        '.srk-toolbar__scroll{display:flex;align-items:center;gap:.75rem;min-width:0;',
        'overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:2px 0;}',
        '.srk-toolbar__scroll::-webkit-scrollbar{display:none;}'
    ].join('');

    function ensureToolbarStyles() {
        if (document.getElementById(TOOLBAR_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = TOOLBAR_STYLE_ID;
        style.textContent = TOOLBAR_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // Emitted by both this module's shell and, in hand-written form, by
    // catalogue.html -- the two must stay the same object, so anything changed
    // here belongs in that markup too.
    function toolbarHTML(filtersHTML) {
        const sortOptions = SORT_OPTIONS
            .map(option => '                    <option value="' + option.value + '">' + escapeHtml(option.label) + '</option>')
            .join('\n');

        return [
            '    <div class="srk-toolbar pb-6 mb-8 w-full border-b border-[#12170f]/10">',
            filtersHTML
                ? [
                    '        <div class="srk-toolbar__group">',
                    '            <span class="srk-toolbar__label" id="category-filters-label">Filter</span>',
                    '            <div id="category-filters" class="srk-toolbar__scroll" role="group" aria-labelledby="category-filters-label">',
                    '                ' + filtersHTML,
                    '            </div>',
                    '        </div>'
                  ].join('\n')
                : '',
            '        <div class="srk-toolbar__group srk-toolbar__group--sort">',
            '            <span class="srk-toolbar__label" id="sort-by-label">Sort by</span>',
            '            <div class="relative flex items-center">',
            '                <select autocomplete="srk-no-autofill" id="sort-by" aria-label="Sort products" class="appearance-none bg-white border border-[#12170f]/10 rounded-full pl-5 pr-10 py-2 text-sm text-[#12170f] outline-none cursor-pointer hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-[#d4af37]">',
            sortOptions,
            '                </select>',
            '                <svg class="w-4 h-4 absolute right-4 text-[#12170f]/40 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
            '                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>',
            '                </svg>',
            '            </div>',
            '        </div>',
            '    </div>'
        ].filter(line => line !== '').join('\n');
    }

    function shellHTML(options, filtersHTML) {
        ensureToolbarStyles();

        return [
            '<div id="' + escapeHtml(options.wrapperId) + '" class="w-full opacity-0 translate-y-6 transition-all duration-[800ms] ease-out flex flex-col">',
            '    <div class="flex items-center justify-between mb-8">',
            '        <h2 class="text-2xl md:text-3xl font-bold tracking-tight">' + escapeHtml(options.title) + '</h2>',
            '    </div>',
            toolbarHTML(filtersHTML),
            '    <div class="product-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>',
            // Painted by render() below, never by shellHTML itself: empty
            // until render() knows whether this selection is even long enough
            // to need it. aria-live so a screen-reader visitor who presses
            // "Load more" hears the updated count, not just a DOM change.
            '    <div class="product-section-more mt-8 text-center" aria-live="polite"></div>',
            '</div>'
        ].join('\n');
    }

    function messageHTML(options, text, withRetry) {
        return [
            '<div id="' + escapeHtml(options.wrapperId) + '" class="w-full flex flex-col">',
            '    <div class="flex items-center justify-between mb-8">',
            '        <h2 class="text-2xl md:text-3xl font-bold tracking-tight">' + escapeHtml(options.title) + '</h2>',
            '    </div>',
            '    <p class="text-center text-[#1f271b]/50 font-semibold py-16">' + escapeHtml(text) + '</p>',
            withRetry
                ? '    <div class="text-center"><button type="button" class="product-section-retry text-sm font-bold text-[#d4af37] hover:underline">Retry</button></div>'
                : '',
            '</div>'
        ].join('\n');
    }

    // A real <button>, not a scroll listener — reachable by keyboard and
    // announced by a screen reader the same way the rest of this shared
    // render path already insists on. '' once every matching product is
    // already painted, which is also the common case today: every section's
    // live catalogue fits in one batch, so the control never appears and the
    // grid looks exactly as it always has.
    function moreControlHTML(shown, total) {
        if (shown >= total) return '';

        const remaining = total - shown;
        return [
            '<p class="text-xs text-[#1f271b]/50 mb-3">Showing ' + shown + ' of ' + total +
                (total === 1 ? ' product' : ' products') + '</p>',
            '<button type="button" class="product-section-load-more px-6 py-2.5 rounded-sm border border-[#12170f]/15 bg-white text-[#12170f] text-xs font-bold uppercase tracking-wider hover:bg-[#12170f] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">Load ' +
                Math.min(PAGE_SIZE, remaining) + ' more</button>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------
    let productsPromise = null;
    let categoriesPromise = null;

    // PAGES THROUGH THE CATALOGUE rather than trusting one response to be
    // all of it — GET /api/products/public's ?page mode returns at most 50
    // rows and says whether more remain (hasMore), specifically so nothing
    // here has to assume a single fetch is the complete catalogue the way
    // this used to. Every section, the cart's re-resolution and the quote
    // picker still see one flat array from loadProducts(): the paging
    // happens once, here, and is invisible to everything that calls it.
    //
    // FETCHED IN CONCURRENT ROUNDS OF PAGE_FETCH_CONCURRENCY, NOT ONE PAGE
    // AT A TIME (P01). A catalogue long enough to need several pages used to
    // pay for every one of them in series — page 2 could not even start
    // until page 1's full round trip had landed — which is exactly the
    // "100 serial requests before first paint" shape the audit flagged.
    // Each round fires several page requests at once and only starts the
    // next round once every request in this one has answered, which is what
    // keeps the loop correct without knowing the total page count up front:
    // publicCatalogueList() answers a page past the real end with
    // `{ items: [], hasMore: false }` rather than an error (see
    // public-catalogue.service.js — an offset-past-the-end range() read is
    // simply empty), so a round that overshoots the last page by a few
    // requests degrades to a few harmless empty responses, never a failure.
    // The loop still only continues past a round when that round's LAST
    // page said hasMore, so it cannot stop early either.
    const PAGE_FETCH_CONCURRENCY = 4;

    async function fetchProductPage(page) {
        const response = await fetch(PRODUCTS_URL + '?page=' + page, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    async function fetchAllProductPages() {
        const all = [];
        let nextPage = 1;
        let hasMore = true;

        while (hasMore) {
            const round = [];
            for (let i = 0; i < PAGE_FETCH_CONCURRENCY; i++) round.push(nextPage + i);
            nextPage += PAGE_FETCH_CONCURRENCY;

            const bodies = await Promise.all(round.map(fetchProductPage));

            bodies.forEach(body => {
                const items = Array.isArray(body && body.items) ? body.items : [];
                all.push(...items);
            });

            const last = bodies[bodies.length - 1];
            hasMore = Boolean(last && last.hasMore);
        }

        return all;
    }

    function loadProducts() {
        if (!productsPromise) {
            productsPromise = fetchAllProductPages()
                .catch(error => {
                    productsPromise = null;   // let Retry try again
                    throw error;
                });
        }
        return productsPromise;
    }

    // Deliberately never rejects. The tree only decides how products are grouped,
    // so a catalogue that loads without it is still worth showing rather than
    // replaced by an error the customer can do nothing about. Each section says
    // in its own file what it does with an empty tree.
    function loadCategories() {
        if (!categoriesPromise) {
            categoriesPromise = fetch(CATEGORIES_URL, { cache: 'no-store' })
                .then(response => {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(data => (Array.isArray(data) ? data : []))
                .catch(error => {
                    console.warn('Product section: category tree unavailable.', error);
                    categoriesPromise = null;   // the next open tries again
                    return [];
                });
        }
        return categoriesPromise;
    }

    // ------------------------------------------------------------------
    // VIEW
    // ------------------------------------------------------------------
    function reveal(wrapperId) {
        requestAnimationFrame(() => {
            const wrapper = document.getElementById(wrapperId);
            if (wrapper) wrapper.classList.remove('opacity-0', 'translate-y-6');
        });
    }

    async function open(options, view) {
        view.innerHTML = messageHTML(options, 'Loading products…', false);

        let products;
        let categories;
        try {
            [products, categories] = await Promise.all([loadProducts(), loadCategories()]);
        } catch (error) {
            console.error(options.title + ': could not load the catalogue.', error);
            view.innerHTML = messageHTML(options, 'Could not load the catalogue. Check your connection and try again.', true);

            const retry = view.querySelector('.product-section-retry');
            if (retry) retry.addEventListener('click', () => open(options, view));
            return;
        }

        const index = indexCategories(categories);
        const selected = options.select ? options.select(products, index) : products;

        // The section is empty because nothing qualifies, which is a different
        // thing from a filter inside it matching nothing — so it gets the
        // section's own wording and no controls the customer cannot act on.
        if (!selected.length) {
            view.innerHTML = messageHTML(options, options.emptyMessage, false);
            return;
        }

        const filters = options.filters ? options.filters(selected, index) : null;

        view.innerHTML = shellHTML(options, filters ? filters.html : '');

        // custom-select-module.js picks injected selects up through a mutation
        // observer, but that runs a tick later — long enough for the raw native
        // dropdown to flash. Enhancing now also guarantees the trigger exists by
        // the time a filter row's own wiring looks for it.
        if (typeof window.enhanceCustomSelects === 'function') window.enhanceCustomSelects(view);

        reveal(options.wrapperId);

        const productContainer = view.querySelector('.product-container');
        const moreHost = view.querySelector('.product-section-more');
        const sortSelect = view.querySelector('#sort-by');
        if (sortSelect) sortSelect.value = DEFAULT_SORT;

        // How many of the CURRENT filtered/sorted set are painted right now
        // — this is DOM-rendering pagination, not another network request:
        // the whole matching set was already resolved above, because
        // search/filter/sort run in the browser and cannot narrow a set they
        // have not seen yet. What this defers is building and inserting a
        // <article> per match in one synchronous innerHTML write, which is
        // the part that actually blocks first paint once a catalogue is long
        // enough to notice.
        let shown = PAGE_SIZE;

        const render = (focusMoreControl) => {
            const match = (filters && filters.match) ? filters.match : () => true;
            const compare = SORTS[sortSelect ? sortSelect.value : DEFAULT_SORT] || SORTS[DEFAULT_SORT];

            // position preserves the API's own order (name ascending) as the
            // stable tie-break, so equal keys never reshuffle between renders.
            const visible = selected
                .filter(match)
                .map((product, position) => ({ product, position }));

            visible.sort((a, b) => compare(a.product, b.product) || a.position - b.position);

            if (!visible.length) {
                productContainer.innerHTML = '<p class="col-span-full text-center text-gray-500 py-10">No products found in this category.</p>';
                if (moreHost) moreHost.innerHTML = '';
                return;
            }

            const batch = visible.slice(0, shown);
            productContainer.innerHTML = batch.map(entry => card(entry.product)).join('\n');

            if (!moreHost) return;

            moreHost.innerHTML = moreControlHTML(batch.length, visible.length);

            const loadMore = moreHost.querySelector('.product-section-load-more');
            if (loadMore) {
                loadMore.addEventListener('click', () => {
                    shown += PAGE_SIZE;
                    render(true);
                });
                if (focusMoreControl) loadMore.focus();
            } else if (focusMoreControl) {
                // That click painted the last of them — nothing left to put
                // keyboard focus on, so it lands on the summary line instead
                // of silently dropping to <body>.
                const summary = moreHost.querySelector('p');
                if (summary) {
                    summary.setAttribute('tabindex', '-1');
                    summary.focus();
                }
            }
        };

        // A filter or sort pick changes WHICH set is being paged, so it
        // starts that set over at its first batch rather than keeping
        // whatever count the previous selection had scrolled to.
        const resetAndRender = () => { shown = PAGE_SIZE; render(); };

        if (sortSelect) sortSelect.addEventListener('change', resetAndRender);
        if (filters && filters.init) filters.init(view, resetAndRender);

        render();
    }

    function register(options) {
        const attach = () => {
            const navButton = document.querySelector('button[data-policy="' + options.policy + '"]');
            if (!navButton) return;

            navButton.addEventListener('click', (event) => {
                event.preventDefault();

                const view = document.getElementById('dynamic-view');
                if (!view) {
                    console.error('Could not find #dynamic-view container.');
                    return;
                }

                open(options, view);
            });
        };

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
        else attach();
    }

    // ------------------------------------------------------------------
    // THE HOME-PAGE PREVIEW ROW
    // ------------------------------------------------------------------
    // A short row on the store home page — a heading, a "View All" link, and
    // the first few products — standing in front of the full section the link
    // opens. "Shop by Category" is the same shape and was the model for it.
    //
    // WHY THIS LIVES BESIDE register() AND NOT IN ITS OWN FILE
    // -------------------------------------------------------
    // The row and the section it links to MUST answer the same question. A
    // "New Arrivals" row whose four products are not among the ones View All
    // leads to is not a preview, it is a second, quietly different answer —
    // and nothing would report the disagreement. So a section declares both
    // from one file and hands the SAME `select` function to each: the row is
    // that function's answer, truncated. It cannot drift, because there is
    // nothing to drift from.
    //
    // WHAT IT NEEDS IN THE PAGE
    // -------------------------
    //     hostId   the whole block, removed outright when nothing qualifies
    //     gridId   the grid inside it, holding skeletons until this replaces
    //              them
    //
    // The heading and the View All link stay in the HTML rather than being
    // generated here, exactly as "Shop by Category" keeps its own: they are
    // real markup a reader can find in the page, and the link has to be a real
    // <a href="#policy"> so middle-click, copy-link-address and Back all work.
    //
    // ORDER
    // -----
    // newestFirst, and not the caller's choice, because a preview that shows
    // an arbitrary four is a worse preview than one that shows the four the
    // customer would meet first — the full sections open on DEFAULT_SORT,
    // which is 'newest'. A section wanting another order passes `order`.
    //
    // FAILURE
    // -------
    // The block removes itself: on an empty selection, and on a catalogue that
    // will not load. A heading over an empty row reads as broken, and the home
    // page has other things on it worth showing — where the full section, which
    // IS the page, offers Retry instead. Same reasoning as
    // featured-categories-loader.js, which does the same thing to the row above
    // this one.
    const PREVIEW_LIMIT = 4;

    function registerPreview(options) {
        const paint = async () => {
            const host = document.getElementById(options.hostId);
            const grid = document.getElementById(options.gridId);
            if (!host || !grid) return;

            let products;
            let categories;
            try {
                [products, categories] = await Promise.all([loadProducts(), loadCategories()]);
            } catch (error) {
                console.error(options.title + ' preview: could not load the catalogue.', error);
                host.remove();
                return;
            }

            const index = indexCategories(categories);
            const selected = options.select ? options.select(products, index) : products;

            if (!selected.length) {
                host.remove();
                return;
            }

            // A copy: `select` may hand back the caller's own array — the
            // filtering ones build a new one, but latestPerCategory's buckets
            // hold references into the shared catalogue — and sorting in place
            // would reorder what every other section on the page is reading.
            const ordered = selected.slice().sort(options.order || newestFirst);

            grid.innerHTML = ordered
                .slice(0, options.limit || PREVIEW_LIMIT)
                .map(card)
                .join('\n');
        };

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
        else paint();
    }

    // ------------------------------------------------------------------
    // CATEGORY FILTER ROW
    // ------------------------------------------------------------------
    // Worked out first for the store's All Products section
    // (all-products-section-loader-module.js) and extracted here once a
    // second page needed the identical behaviour (catalogue.html) rather
    // than a second, drifting copy. Categories nest (categories.parent_id),
    // and a flat tab row would put a parent and its children side by side as
    // if they were peers, so a child's products roll up into its root
    // ancestor's tab, and any tab whose category has children becomes a
    // dropdown listing them:
    //
    //     Machine Spare Parts (Common) ▾
    //                                  ├─ Common
    //                                  ├─ Blades
    //                                  └─ Motors
    //
    // "Common" is the products filed directly on the parent; a picked child
    // narrows to that child and everything nested under it. Not special-cased
    // on any name -- any tab whose category has children gets a dropdown, so
    // renaming or restructuring categories needs no code
    // change on either page.
    //
    // categoryFilterRow(options) is a factory, not the row itself: it takes
    // what genuinely differs per page -- the default-open tab's name, a
    // style-tag id so two pages never share one <style> element, and the
    // tick colour, since a capsule's checkmark answers the same
    // `* { color: ... }` / currentColor trap documented elsewhere in this file
    // and every page paints it to match its own palette -- and returns a
    // `filters(products, index)` function with exactly the shape `register`'s
    // `options.filters` already expects: `{ html, match, init }`. Everything
    // else (the tab-building, the capsule markup, the capture-phase listener
    // that makes the first click on an inactive capsule select rather than
    // open, the aria-expanded MutationObserver that is the keyboard path) is
    // identical on every page that calls this.
    const CATEGORY_DIRECT_ONLY = '__direct__';
    const CATEGORY_DIRECT_ONLY_LABEL = 'Common';

    const CATEGORY_PILL_CLASSES = 'px-5 py-2 rounded-full border border-[#12170f]/10 bg-white text-[#12170f] text-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-all';

    // One tab per root category that actually has products somewhere beneath
    // it, ordered by name, "All" first. Derived from the products themselves
    // so the row cannot list a category a visitor would click into and find
    // empty.
    // `allCategories` is opt-in and off by default, so All Products' own tab
    // list is untouched: a root with zero products anywhere under it gets no
    // tab there, on purpose, so a customer never clicks into an empty grid.
    // catalogue.html opts in, by request — an active root category should
    // read as a real part of the catalogue the moment it is published, not
    // only once something happens to be filed under it.
    function buildCategoryTabs(products, index, options) {
        const allCategories = !!(options && options.allCategories);
        const roots = new Map();

        if (allCategories) {
            index.byId.forEach(entry => {
                if (!entry.parentId) roots.set(entry.id, entry.name);
            });
        } else {
            products.forEach(product => {
                const key = categoryKey(product);
                if (key === UNCATEGORISED) return;

                const root = rootOf(index, key);

                // A product whose category was deactivated or deleted still
                // carries that category's id. It stays visible under "All" --
                // exactly like a product with no category at all -- but must not
                // raise a tab naming a category that has been taken down:
                // /api/categories/public publishes active rows only, and the tab
                // row should say the same thing.
                //
                // An empty tree means the categories call failed, not that
                // nothing is active, so there is nothing to check against and
                // every category a product names still gets its tab.
                if (index.byId.size > 0 && !index.byId.has(root)) return;

                if (roots.has(root)) return;

                // With the tree known, the root is in it by the guard above.
                // Without one, root === key and the product names its own
                // category.
                const category = index.byId.get(root);
                const label = category ? category.name : (product.category_name || 'Category ' + key);

                roots.set(root, label);
            });
        }

        const tabs = [...roots.entries()]
            .map(([key, label]) => ({ key, label, children: index.children.get(key) || [] }))
            .sort((a, b) => a.label.localeCompare(b.label));

        return [{ key: 'all', label: 'All', children: [] }, ...tabs];
    }

    // Matched by name, not id -- there is no stable "this is the core
    // catalogue" flag, so the caller passes the name it already uses
    // elsewhere on its page (e.g. "Machinery", same reasoning
    // request-quote-module.js defaults its own category picker to).
    // Case-insensitive so a capitalisation change upstream
    // does not silently break it; no match falls back to "All".
    function defaultCategoryTabKey(tabs, name) {
        const target = String(name || '').trim().toLowerCase();
        if (!target) return 'all';

        const match = tabs.find(tab => tab.label.trim().toLowerCase() === target);
        return match ? match.key : 'all';
    }

    function categoryFilterRow(options) {
        const opts = options || {};
        const styleId = opts.styleId || 'category-filter-row-styles';
        const tickColor = opts.tickColor || '#d4af37';
        const defaultTabName = opts.defaultTabName || '';
        const allCategories = !!opts.allCategories;

        // The dropdown itself is custom-select-module.js's, so the panel,
        // keyboard handling and palette stay the site's one dropdown rather
        // than a second implementation of it. These rules only strip the
        // trigger back to bare text so it reads as part of the pill instead
        // of a field sitting inside one, and put the brackets on in CSS --
        // keeping them out of the option text, so the open panel lists
        // "Common", not "(Common)".
        //
        // The tick colour is painted here, not left to a Tailwind class on
        // the SVG, for the same currentColor trap every page's universal
        // `* { color: ... }` rule sets up: a direct match beats an inherited
        // one, so a class on a stroke="currentColor" glyph never reaches it.
        const FILTER_CSS = [
            '.category-btn .check-icon{stroke:' + tickColor + ';}',

            '.category-capsule__select{position:relative;display:inline-flex;align-items:center;gap:.3rem;}',

            '.category-capsule .srk-select__trigger{background:transparent!important;border:0!important;',
            'padding:0!important;margin:0!important;box-shadow:none!important;min-width:0;',
            'font:inherit;color:inherit;}',
            '.category-capsule .srk-select__trigger:focus-visible{outline:2px solid #d4af37;outline-offset:3px;border-radius:2px;}',

            '.category-capsule .srk-select__label{flex:none;opacity:.6;}',
            '.category-capsule .srk-select__label::before{content:"(";}',
            '.category-capsule .srk-select__label::after{content:")";}',

            '.category-capsule__chevron{flex:none;opacity:.45;transition:transform .18s ease;}',
            '.category-capsule__select:has(.srk-select__trigger[aria-expanded="true"]) .category-capsule__chevron{transform:rotate(180deg);}',

            '@media (prefers-reduced-motion:reduce){.category-capsule__chevron{transition:none;}}'
        ].join('');

        function ensureFilterStyles() {
            if (document.getElementById(styleId)) return;

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = FILTER_CSS;
            (document.head || document.documentElement).appendChild(style);
        }

        // The inline text-[...] class is redundant with the CSS rule above
        // (a direct match beats an inherited one, so the CSS always wins) but
        // is kept so this stays byte-for-byte what the original markup wrote,
        // for whatever reads the class rather than the computed stroke.
        const CHECK_ICON = '<svg class="check-icon w-4 h-4 text-[' + tickColor + '] hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';

        function filterButton(tab) {
            if (tab.children.length) return filterCapsule(tab);

            return [
                '<button data-category="' + escapeHtml(tab.key) + '" class="category-btn ' + CATEGORY_PILL_CLASSES + '">',
                '    ' + CHECK_ICON,
                '    <span class="font-normal">' + escapeHtml(tab.label) + '</span>',
                '</button>'
            ].join('\n');
        }

        // A <div>, not a <button>: it contains the dropdown's own trigger
        // button, and nesting one button inside another is invalid markup
        // that browsers repair by splitting the elements apart.
        //
        // The chevron is drawn here rather than left to custom-select-module,
        // which only adds its own when the select has no sibling <svg>. Its
        // version is absolutely positioned with the padding to match, which
        // would reserve a field-sized gutter inside the pill.
        function filterCapsule(tab) {
            const options = [{ id: CATEGORY_DIRECT_ONLY, name: CATEGORY_DIRECT_ONLY_LABEL }, ...tab.children]
                .map(option => '<option value="' + escapeHtml(option.id) + '">' + escapeHtml(option.name) + '</option>')
                .join('');

            return [
                '<div data-category="' + escapeHtml(tab.key) + '" class="category-btn category-capsule ' + CATEGORY_PILL_CLASSES + '">',
                '    ' + CHECK_ICON,
                '    <span class="font-normal">' + escapeHtml(tab.label) + '</span>',
                '    <span class="category-capsule__select">',
                '        <select autocomplete="srk-no-autofill" aria-label="' + escapeHtml(tab.label) + ' sub-category">' + options + '</select>',
                '        <svg class="category-capsule__chevron w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>',
                '    </span>',
                '</div>'
            ].join('\n');
        }

        // Called once per open with the products this page is showing.
        // Returns the row's markup, the predicate the caller filters on, and
        // the wiring to run once that markup is in the document -- exactly
        // the { html, match, init } shape register()'s options.filters
        // already expects.
        return function filters(products, index) {
            ensureFilterStyles();

            const tabs = buildCategoryTabs(products, index, { allCategories });

            let category = defaultCategoryTabKey(tabs, defaultTabName);

            // Tab key -> its sub-category <select>. Only tabs that have
            // children are in here; every other tab filters on an exact
            // category match.
            const capsules = new Map();

            // subtreeKeys walks the tree on every call and the filter runs it
            // once per product, so the answer is kept.
            const subtrees = new Map();
            const keysUnder = (key) => {
                if (!subtrees.has(key)) subtrees.set(key, subtreeKeys(index, key));
                return subtrees.get(key);
            };

            return {
                html: tabs.map(filterButton).join('\n'),

                match(product) {
                    if (category === 'all') return true;

                    const key = categoryKey(product);
                    const select = capsules.get(category);
                    if (!select) return key === category;

                    // "Common": the parent on its own. Anything filed on a
                    // child belongs to that child's option, not to this one.
                    if (select.value === CATEGORY_DIRECT_ONLY) return key === category;

                    return keysUnder(select.value).has(key);
                },

                init(view, rerender) {
                    const btns = [...view.querySelectorAll('.category-btn')];

                    const paint = () => btns.forEach(btn => {
                        const isSelected = btn.dataset.category === category;
                        btn.querySelector('.check-icon').classList.toggle('hidden', !isSelected);
                        btn.classList.toggle('bg-gray-50', isSelected);

                        // WHICH FILTER IS ON WAS A PURELY VISUAL FACT.
                        //
                        // Selection was communicated by a tick icon losing its
                        // `hidden` class, a background tint and a border
                        // colour — three things a sighted user reads at a
                        // glance and a screen reader is told nothing about. A
                        // row of buttons that narrows a product grid is a set
                        // of toggles, and aria-pressed is what says so.
                        //
                        // Only on real <button>s. A tab whose category has
                        // children is rendered as a <div> capsule holding a
                        // <select> (a <button> cannot legally contain the
                        // trigger button custom-select-module builds), and
                        // aria-pressed on a plain div is invalid ARIA that
                        // announces nothing useful — there, the <select>
                        // inside is already the accessible control and reports
                        // its own value. data-selected carries the state for
                        // both, which is also what makes the active tab
                        // assertable from a test.
                        btn.dataset.selected = isSelected ? 'true' : 'false';
                        if (btn.tagName === 'BUTTON') btn.setAttribute('aria-pressed', String(isSelected));

                        if (isSelected) {
                            btn.classList.add('border-[#d4af37]/30');
                            btn.classList.remove('border-[#12170f]/10');
                        } else {
                            btn.classList.remove('border-[#d4af37]/30');
                            btn.classList.add('border-[#12170f]/10');
                        }
                    });

                    btns.forEach(btn => {
                        // By tag, and deliberately not by a marker class:
                        // custom-select-module copies the select's own
                        // classes onto the trigger it builds, and inserts
                        // that trigger *before* the select -- so any class
                        // hook put on the select here matches the trigger
                        // <button> first and hands back an element whose
                        // .value is always "". Every capsule filter then
                        // quietly matches nothing.
                        const select = btn.querySelector('select');

                        // Null until custom-select-module.js has enhanced the
                        // select. It is enhanced before this runs, but a
                        // capsule left un-enhanced (the module missing, or an
                        // older browser it bailed on) still has to filter --
                        // it just falls back to the plain-tab behaviour
                        // below.
                        const trigger = select ? btn.querySelector('.srk-select__trigger') : null;

                        if (select) capsules.set(btn.dataset.category, select);

                        const choose = () => {
                            if (category === btn.dataset.category) return;
                            category = btn.dataset.category;
                            paint();
                            rerender();
                        };

                        // Capture, so this runs before the trigger's own
                        // click listener and before custom-select-module's
                        // document-level one -- the only place a click on an
                        // inactive capsule can be stopped before it opens a
                        // panel.
                        btn.addEventListener('click', (event) => {
                            if (!trigger) { choose(); return; }

                            // An inactive capsule is a tab before it is a
                            // dropdown. One click used to do both -- pick the
                            // category *and* drop the panel open over the
                            // grid it had just changed -- because opening the
                            // panel is what selects the tab (see the observer
                            // below). So the first click only selects; the
                            // panel is what the *next* click is for, once
                            // this is the tab you are already on.
                            if (category !== btn.dataset.category) {
                                event.preventDefault();
                                event.stopPropagation();
                                choose();
                                return;
                            }

                            // The trigger handles clicks that land on it.
                            // Everywhere else on the pill opens the menu too,
                            // so the whole capsule behaves as one control
                            // rather than a label with a control inside it.
                            if (event.target.closest('.srk-select__trigger')) return;

                            event.preventDefault();
                            // custom-select-module closes any open panel on a
                            // document-level click it does not recognise, and
                            // this one landed on the pill rather than the
                            // trigger -- so it would shut the very panel the
                            // synthetic click below is opening.
                            event.stopPropagation();
                            trigger.click();
                        }, true);

                        // Opening the panel also selects the tab, which after
                        // the handler above is the *keyboard* path: Enter /
                        // Space / arrow keys with the trigger focused. A
                        // keyboard visitor has no other affordance for
                        // picking an inactive capsule -- the pill is a <div>
                        // and the trigger is the only focusable thing in it
                        // -- so for them opening and selecting stay one
                        // action, deliberately. Watching the state the
                        // dropdown already publishes is also what makes
                        // re-picking the value already selected apply: that
                        // fires no change event.
                        if (trigger) {
                            new MutationObserver(() => {
                                if (trigger.getAttribute('aria-expanded') === 'true') choose();
                            }).observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
                        }

                        // The tab may already be current here while the
                        // sub-category is not, so this always re-renders
                        // rather than going through choose().
                        if (select) select.addEventListener('change', () => {
                            category = btn.dataset.category;
                            paint();
                            rerender();
                        });
                    });

                    paint();
                }
            };
        };
    }

    window.productSection = {
        register,
        registerPreview,
        escapeHtml,
        card,
        categoryKey,
        indexCategories,
        rootOf,
        subtreeKeys,
        newestFirst,
        // Exported so anything else on the page that needs the catalogue reads
        // the same two cached promises these sections do, rather than opening a
        // third and fourth request for data already in memory. Both keep the
        // contract described above: loadProducts rejects and clears its cache so
        // a retry can refetch, loadCategories never rejects and resolves [].
        loadProducts,
        loadCategories,
        formatPrice,
        resolveMainImage,
        // The one rule for "can this be bought", exported so the details
        // overlay decides with the same test the card did rather than a second
        // copy that could drift from it — and from priceCheckout()'s.
        isPurchasable,
        // Exported for product-details-module.js, which shows the same badge
        // on the same product. A copied PLACEMENTS table is exactly the
        // near-miss duplicate this file was extracted to stop.
        placementFor,
        SORTS,
        SORT_OPTIONS,
        DEFAULT_SORT,
        UNCATEGORISED,
        // The hierarchy-aware filter row, extracted from
        // all-products-section-loader-module.js once catalogue.html needed
        // the identical behaviour. buildCategoryTabs/defaultCategoryTabKey
        // are exported alongside the factory itself only because a caller
        // that wants to build its own tab list without the row's markup/
        // wiring (none does today) shouldn't have to reconstruct them.
        categoryFilterRow,
        buildCategoryTabs,
        defaultCategoryTabKey,
        // catalogue.html writes the Filter / Sort by toolbar into its own
        // static markup (its sort <select> has to exist before
        // custom-select-module.js runs, so it cannot come from shellHTML), and
        // needs the rules that paint the two labels. One stylesheet, injected
        // once, whichever page asks first.
        ensureToolbarStyles
    };
})();
