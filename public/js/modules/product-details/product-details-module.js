/**
 * product-details-module.js  (window.productDetails)
 *
 * The product detail surface product-section-shared-module.js has been
 * waiting for. Its card comment says it plainly:
 *
 *     "No product detail route exists yet, so the card deliberately does
 *      not navigate — it used to send every click to a 404. The id and
 *      slug ride along on the element, ready for a real route later."
 *                            — product-section-shared-module.js
 *
 * This is that route, and it is an overlay rather than a page for the same
 * reason store-search-module.js's results are: this page cannot rebuild its
 * home view once destroyed. The bundle slider binds #bundle-prev at
 * DOMContentLoaded, so restoring markup from a string hands back dead
 * buttons, and re-clicking the gold .nav-btn to re-render would *navigate*
 * when that button is "home". An overlay touches none of it.
 *
 * WHY THE RAIL IS A PINNED SIBLING, NOT A STICKY BAR
 * --------------------------------------------------
 * request-quote-module.js and profile-icon-loader.js pin their submit bars
 * with `sticky bottom-0` inside the scroll body. That is right for a bar the
 * visitor scrolls *to* and wrong for a rail they scroll *past*: a sticky
 * element stays in the scroll flow, so the content slides underneath it.
 * This asks openOverlay for a real `shrink-0` footer sibling instead — the
 * shape openDrawer already gives the cart — so the product region scrolls
 * genuinely independently of the rail below it.
 *
 * DATA — HALF REAL, HALF SAMPLE, AND THE SEAM IS VISIBLE
 * -----------------------------------------------------
 * The product is real: window.productSection.loadProducts(), the same cached
 * promise the four sections, the search overlay, the cart and the quote form
 * read. So opening details after browsing costs no request, no new API route
 * is needed, and what is shown here can never drift from the card that was
 * clicked. The bottom rail is sample data behind a DATA SOURCE block — the
 * same seam cart-module.js and my-orders-module.js use.
 *
 * LOAD ORDER
 * ----------
 * After product-section-shared-module.js and store-overlay-shared-module.js
 * (both destructured at load), after price-format-module.js and
 * cart-module.js (read at click time), and before
 * view-state-restore-module.js, which must stay last on the page.
 */

(() => {
    'use strict';

    if (window.productDetails) return;

    const section = window.productSection;
    if (!section) {
        console.error('product-details-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('product-details-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml, formatPrice, placementFor, isPurchasable } = section;

    const {
        PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, ICON_BUTTON_CLASSES,
        EYEBROW_CLASSES, CLOSE_ICON, PLUS_ICON, MINUS_ICON,
        icon, ensureStyles, prefersReducedMotion, enhance, centredMessageHTML
    } = chrome;

    // ------------------------------------------------------------------
    // DATA SOURCE — sample rail, replace when the routes below exist
    // ------------------------------------------------------------------
    // The product on this page is real. The rail is not, and cannot be yet:
    // there is no table that says "these two go together" and no route that
    // answers "what else is like this". So it follows the seam cart-module.js
    // and my-orders-module.js use — one accessor whose body is a lookup today
    // and a fetch later, with nothing above it changing when that happens.
    //
    // TODO: replace loadRail() with
    //   GET /api/products/:id/combinations -> [{ id, name, category_name, price, image_url }]
    //   GET /api/products/:id/related      -> the same shape
    // Both want the envelope /api/products/public already returns, so the tile
    // below needs no change on the day they land — only `id` starts arriving,
    // and that is what turns an inert tile into a real card (see railCardHTML).
    //
    // Image paths are folders that exist on disk. Rapid Frame holds only an
    // INFO.txt, and Cutting Machine / Pinning Machine hold only per-spare-part
    // subfolders, so those are reached through a subfolder or not used.
    const SAMPLE_RAIL = {
        combinations: [
            { id: null, name: 'Frame Master + V-Nail Starter Set', category_name: 'Bundle', price: '78500', image_url: '/assets/products/Frame Master/AVIF/01.avif' },
            { id: null, name: 'Trim Craft + Blade Service Kit', category_name: 'Bundle', price: '41200', image_url: '/assets/products/Trim Craft/AVIF/01.avif' },
            { id: null, name: 'KonaFit Workshop Pack', category_name: 'Bundle', price: 'On request', image_url: '/assets/products/KonaFit/AVIF/01.avif' },
            { id: null, name: 'Pinner + Hook Press Line', category_name: 'Bundle', price: '1,18,000', image_url: '/assets/products/Swift Frame Pinner/AVIF/01.avif' }
        ],
        more: [
            { id: null, name: 'Swift Frame Pinner', category_name: 'Machinery', price: '66000', image_url: '/assets/products/Swift Frame Pinner/AVIF/01.avif' },
            { id: null, name: 'MDF Hook Press Machine', category_name: 'Machinery', price: '52000', image_url: '/assets/products/MDF Hook Press Machine/AVIF/01.avif' },
            { id: null, name: 'Trim Craft', category_name: 'Machinery', price: '38500', image_url: '/assets/products/Trim Craft/AVIF/01.avif' },
            { id: null, name: 'Rubber Support', category_name: 'Machine Spare Parts', price: 'On request', image_url: '/assets/products/Cutting Machine/Rubber Support/AVIF/01.avif' },
            { id: null, name: 'Adjustable Bolt', category_name: 'Machine Spare Parts', price: '450', image_url: '/assets/products/Pinning Machine/Adjustable Bolt/AVIF/01.avif' }
        ]
    };

    async function loadRail(productId, which) {
        return SAMPLE_RAIL[which] || [];
    }

    // ------------------------------------------------------------------
    // TOKENS
    // ------------------------------------------------------------------
    // The shared SHELL (max-w-3xl) is a reading column: right for the quote
    // and account forms, wrong for a two-column product page, where it would
    // give each column ~350px — narrower than the card the visitor just
    // clicked. store-search-module.js reaches for max-w-7xl for its three-up
    // result grid; two columns want less than that. A local token, for the
    // same reason and by the same precedent, not a change to the shared one.
    const DETAILS_SHELL = 'w-full max-w-6xl mx-auto px-6 md:px-10 lg:px-12';

    // Matches cart-module.js's ceiling, so a quantity chosen here can always
    // be carried by the line it becomes.
    const MAX_QUANTITY = 99;

    // `enabled: false` hides a tab without removing anything behind it — the
    // SAMPLE_RAIL entry, the cards and the whole paint path stay exactly where
    // they are, so re-enabling is this one word.
    //
    // Combinations is off because there is nothing true to put in it. It has no
    // table saying "these two go together" and no route to ask, so every tile
    // under it was an invented bundle at an invented price ("Frame Master +
    // V-Nail Starter Set, Rs 78,500") sitting inside a real product's overlay,
    // where a customer has no way to tell it apart from the product above it.
    // An empty tab would have been honest; a populated fictional one is not.
    // Turn it back on with the combinations route in the DATA SOURCE block
    // above — on that day the tiles stop being invented and this flag flips.
    const RAIL_TABS = [
        { key: 'combinations', label: 'Combinations', enabled: false },
        { key: 'more', label: 'More Products', enabled: true }
    ];

    // What the rail actually offers. Everything that draws a chip or picks a
    // default reads this, never RAIL_TABS — a disabled tab must not be drawn
    // and must not be the tab the overlay opens on.
    const ACTIVE_RAIL_TABS = RAIL_TABS.filter(tab => tab.enabled);

    // With every tab disabled there is no rail to show; callers fall back to
    // an empty key, which loadRail() answers with [] and the rail renders as
    // its own "nothing to show" state rather than throwing.
    const defaultRailTab = () => (ACTIVE_RAIL_TABS[0] ? ACTIVE_RAIL_TABS[0].key : '');

    const PILL_CLASSES = 'details-chip px-4 py-1.5 rounded-full border bg-white text-[#12170f] text-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]';

    const STEP_CLASSES = 'store-icon w-9 h-9 flex items-center justify-center rounded-sm border border-[#12170f]/10 bg-white hover:border-[#d4af37] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]';

    const RAIL_NAV_CLASSES = 'store-icon w-9 h-9 rounded-full border border-[#12170f]/10 bg-white flex items-center justify-center hover:border-[#d4af37] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]';

    // The magnifier. 180px across at 2.5x is the smallest pair that still
    // resolves a cast marking or a thread pitch — the detail a buyer leans in
    // for on a machine part.
    const LENS_SIZE = 180;
    const LENS_ZOOM = 2.5;

    // ------------------------------------------------------------------
    // ICONS
    // ------------------------------------------------------------------
    // The shared set has no left/right chevron. These are the same two paths
    // store.html draws for its bundle slider.
    const LEFT_ICON = icon('M15 19l-7-7 7-7');
    const RIGHT_ICON = icon('M9 5l7 7-7 7');
    const tickIcon = (shown) =>
        '<svg class="check-icon w-4 h-4' + (shown ? '' : ' hidden') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    const STYLE_ID = 'store-details-styles';

    const CSS = [
        // The card is a route now. It carried no affordance because it went
        // nowhere. Done here rather than inside card() so the four sections
        // and the search overlay share one markup string and pick this up.
        'article[data-product-id]{cursor:pointer;}',

        // cart-module.js has an identical rule under its own class. Kept
        // separate rather than shared because this overlay must not depend on
        // that module having loaded or run. (Its sheet used to be injected
        // only on first drawer open, which made this a hard requirement; it
        // now injects on load, so this is insurance rather than necessity.)
        '.details-qty-input{-moz-appearance:textfield;appearance:none;}',
        '.details-qty-input::-webkit-outer-spin-button,.details-qty-input::-webkit-inner-spin-button{',
        '-webkit-appearance:none;margin:0;}',

        // The `* { color: … }` / currentColor trap, for the third time on this
        // page. all-products-section-loader-module.js paints its tick with a
        // rule scoped to .category-btn, so this one needs its own or it
        // renders as body text.
        '.details-chip .check-icon{stroke:#d4af37;}',

        // store.html defines .no-scrollbar, but re-declaring keeps the module
        // self-contained. Identical rules, so the duplicate is inert.
        '.no-scrollbar::-webkit-scrollbar{display:none;}',
        '.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none;}',

        // The magnifier. Absolute inside the stage, which is overflow-hidden,
        // so a lens near an edge is clipped by the frame rather than spilling
        // over the page — and it stays centred on the cursor, which is the
        // whole promise, instead of being nudged back inside.
        '#product-details-lens{position:absolute;z-index:20;pointer-events:none;',
        'width:' + LENS_SIZE + 'px;height:' + LENS_SIZE + 'px;border-radius:9999px;overflow:hidden;',
        'background:#f1f5f9;border:1px solid rgba(18,23,15,.14);',
        'box-shadow:0 8px 28px rgba(18,23,15,.18);',
        'opacity:0;transition:opacity 140ms ease;}',
        '#product-details-lens.is-on{opacity:1;}',

        // The blend sits on the inner layer, not the lens, so the zoomed
        // pixels meet the stage's grey exactly as the <img> above them does,
        // without multiplying the lens border and shadow into the page too.
        '.details-lens__img{width:100%;height:100%;background-repeat:no-repeat;mix-blend-mode:multiply;}',

        // No cursor to follow, and on a touch screen the lens would only ever
        // sit under the finger that summoned it.
        '@media (hover:none){#product-details-lens{display:none;}}',

        '@media (prefers-reduced-motion:reduce){',
        '#product-details-rail{scroll-behavior:auto;}',
        '#product-details-lens{transition:none;}',
        '}'
    ].join('');

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    let handle = null;      // the openOverlay handle, or null when closed
    let product = null;     // the resolved catalogue row
    let gallery = [];       // normalised images, slot order
    let activeImage = 0;
    let quantity = 1;
    let railTab = defaultRailTab();
    let currentId = null;   // what paint() last asked for, so Retry can repeat it
    let token = 0;          // guards a stale async paint from landing last
    let escapeGuard = null;

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------
    // 0 to 4 images, and 1 is the common case. `image_url` is derived from
    // `images` server-side, so the synthesised branch should be unreachable —
    // it is here so a payload that ever arrives half-formed still renders.
    function imagesOf(row) {
        const images = (Array.isArray(row.images) ? row.images : [])
            .filter(image => image && image.url)
            .slice()
            .sort((a, b) => (a.slot || 0) - (b.slot || 0));

        if (images.length) return images;
        if (row.image_url) return [{ slot: 1, is_main: true, url: row.image_url }];
        return [];
    }

    // Mirrors resolveMainImage's ladder, but returns the index rather than the
    // URL, so the gallery opens on the same picture the card showed.
    function startIndexOf(row, images) {
        const main = images.findIndex(image => image.is_main === true);
        if (main !== -1) return main;

        const byUrl = images.findIndex(image => image.url === row.image_url);
        if (byUrl !== -1) return byUrl;

        return 0;
    }

    function clampQuantity(value) {
        const parsed = Math.floor(Number(String(value).trim()));
        if (!Number.isFinite(parsed) || parsed < 1) return 1;
        return Math.min(parsed, MAX_QUANTITY);
    }

    // The card's 404 idiom: a URL that fails reveals the product name instead
    // of an empty grey box, and the stand-in stays hidden behind a loaded
    // image so it can never read as a watermark across the photo.
    function mediaHTML(row) {
        const name = escapeHtml(row.name || 'Product');
        const image = gallery[activeImage];

        if (!image) {
            return '<div class="absolute inset-8 flex items-center justify-center text-center text-[#12170f]/30 text-base font-semibold px-2">' + name + '</div>';
        }

        return '<img src="' + escapeHtml(image.url) + '" alt="' + name + '"' +
            ' class="w-full h-full object-contain mix-blend-multiply"' +
            ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
            '\n<div class="absolute inset-8 items-center justify-center text-center text-[#12170f]/30 text-base font-semibold px-2" style="display:none">' + name + '</div>';
    }

    function railMediaHTML(item) {
        const name = escapeHtml(item.name || 'Product');

        if (!item.image_url) {
            return '<div class="absolute inset-1 flex items-center justify-center text-center text-[#12170f]/25 text-[9px] font-bold leading-tight">' + name + '</div>';
        }

        return '<img src="' + escapeHtml(item.image_url) + '" alt="' + name + '" loading="lazy"' +
            ' class="w-full h-full object-contain mix-blend-multiply"' +
            ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
            '\n<div class="absolute inset-1 items-center justify-center text-center text-[#12170f]/25 text-[9px] font-bold leading-tight" style="display:none">' + name + '</div>';
    }

    // ------------------------------------------------------------------
    // MARKUP — chrome
    // ------------------------------------------------------------------
    // The heading block is the only part of the header that ever repaints, and
    // it is deliberately a *sibling* of the close button rather than its
    // parent: openOverlay binds that button once when the overlay is created,
    // so replacing the whole <header> would hand back a dead close button.
    //
    // The name lives here rather than in the buy column so it stays on screen
    // while the product region scrolls, and so aria-labelledby points at a
    // heading a sighted visitor actually gets. The <h2> tag is also the only
    // way to reach Schibsted Grotesk — store.html applies it by tag, and a
    // <div class="text-2xl font-bold"> would render in Manrope.
    function headingHTML(row) {
        if (!row) {
            return '<h2 id="product-details-title" class="text-2xl md:text-3xl font-bold tracking-tight text-[#12170f]">Product</h2>';
        }

        const category = String(row.category_name || '').trim();

        return [
            category ? '<span class="' + EYEBROW_CLASSES + ' block mb-1">' + escapeHtml(category) + '</span>' : '',
            '<h2 id="product-details-title" class="text-2xl md:text-3xl font-bold tracking-tight text-[#12170f] leading-tight">' + escapeHtml(row.name || 'Product') + '</h2>'
        ].filter(line => line !== '').join('\n');
    }

    function headerHTML() {
        return [
            '<header class="shrink-0 bg-white border-b border-[#12170f]/10">',
            '    <div class="' + DETAILS_SHELL + ' py-5 md:py-6 flex items-start justify-between gap-6">',
            '        <div id="product-details-heading" class="min-w-0">',
            '            ' + headingHTML(null),
            '        </div>',
            '        <button type="button" id="product-details-close" class="store-icon ' + ICON_BUTTON_CLASSES + '" aria-label="Close product details">',
            '            ' + CLOSE_ICON,
            '        </button>',
            '    </div>',
            '</header>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — gallery
    // ------------------------------------------------------------------
    // Arrows, thumbnails and the counter are built only when there is more
    // than one image — and when they are not built they are *absent from the
    // DOM*, never hidden with opacity. The shared focus trap filters on
    // `offsetParent !== null`, so an opacity-0 button would survive as an
    // invisible tab stop.
    function galleryHTML(row) {
        const many = gallery.length > 1;
        const placement = placementFor(row);

        return [
            // Thumbs come first in the DOM so md:flex-row lands them on the
            // left. On a phone flex-col-reverse flips that back to a strip
            // under the stage, because a vertical rail there would eat width
            // the picture needs.
            '<div class="flex flex-col-reverse gap-3 md:flex-row md:items-start">',
            many ? '    ' + thumbsHTML(row) : '',
            '    <div id="product-details-stage" class="relative flex-1 min-w-0 aspect-[4/3] lg:aspect-square bg-[#f1f5f9] border border-[#12170f]/10 rounded-sm flex items-center justify-center p-8 overflow-hidden">',
            placement
                ? '        <span class="absolute top-3 left-3 z-10 ' + placement.classes + ' text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-wider">' + placement.label + '</span>'
                : '',
            '        <div class="details-media relative w-full h-full flex items-center justify-center">' + mediaHTML(row) + '</div>',
            many
                ? '        <button type="button" data-details-action="prev-image" class="' + RAIL_NAV_CLASSES + ' absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/90" aria-label="Previous image">' + LEFT_ICON + '</button>'
                : '',
            many
                ? '        <button type="button" data-details-action="next-image" class="' + RAIL_NAV_CLASSES + ' absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/90" aria-label="Next image">' + RIGHT_ICON + '</button>'
                : '',
            many
                ? '        <span id="product-details-counter" class="absolute bottom-3 right-3 z-10 px-2 py-0.5 rounded-full bg-white/90 border border-[#12170f]/10 text-[10px] font-bold text-[#1f271b]/60">' + (activeImage + 1) + ' / ' + gallery.length + '</span>'
                : '',
            // A sibling of .details-media, never inside it: showImage()
            // rebuilds that subtree on every image change and would take
            // the lens with it.
            '        <div id="product-details-lens" aria-hidden="true"><div class="details-lens__img"></div></div>',
            '    </div>',
            '</div>'
        ].filter(line => line !== '').join('\n');
    }

    function thumbsHTML(row) {
        const name = escapeHtml(row.name || 'Product');

        const tiles = gallery.map((image, index) => {
            const on = index === activeImage;

            return [
                '<button type="button" data-details-image="' + index + '" aria-current="' + (on ? 'true' : 'false') + '"',
                '        class="shrink-0 w-16 h-16 md:w-[72px] md:h-[72px] rounded-sm bg-[#f1f5f9] border-2 ' +
                (on ? 'border-[#d4af37]' : 'border-[#12170f]/10 hover:border-[#d4af37]/60') +
                ' flex items-center justify-center p-1.5 overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]"',
                '        aria-label="Show image ' + (index + 1) + ' of ' + name + '">',
                '    <img src="' + escapeHtml(image.url) + '" alt="" loading="lazy" class="w-full h-full object-contain mix-blend-multiply"',
                '         onerror="this.style.visibility=\'hidden\';" />',
                '</button>'
            ].join('\n');
        });

        return '<div class="flex flex-row md:flex-col gap-2 shrink-0 overflow-x-auto md:overflow-visible no-scrollbar">' +
            tiles.join('\n') + '</div>';
    }

    // ------------------------------------------------------------------
    // MARKUP — buy column
    // ------------------------------------------------------------------
    // The name is not repeated here; it is in the header, pinned. This column
    // starts at the price and keeps only a short lede, because both CTAs live
    // in the scroll region and anything above them pushes them down the page.
    // The long copy goes in its own block below the grid.
    function buyHTML(row) {
        const priceText = formatPrice(row.price) || 'Price on request';
        const lede = ledeOf(row);

        return [
            '<div class="flex flex-col">',
            '    <p class="text-3xl font-bold text-[#12170f] tracking-tight">' + escapeHtml(priceText) + '</p>',
            lede
                ? '    <p class="text-base text-[#1f271b]/70 leading-relaxed mt-4">' + escapeHtml(lede) + '</p>'
                : '    <p class="text-sm text-[#1f271b]/40 italic mt-4">No description added.</p>',
            '    <div class="border-t border-[#12170f]/10 my-7"></div>',
            '    ' + stepperHTML(row),
            '    ' + ctasHTML(row),
            // Only where the product can be bought. On an unpriced one the CTA
            // above already IS the quote route and carries this same id, and
            // two elements sharing an id is both invalid and a coin toss over
            // which one the handler finds.
            isPurchasable(row)
                ? '    <p class="text-xs text-[#1f271b]/50 mt-4">Need volume pricing or a proforma invoice? <button type="button" id="product-details-to-quote" class="font-bold text-[#d4af37] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-sm">Request a quote</button>.</p>'
                : '    <p class="text-xs text-[#1f271b]/50 mt-4">This product is priced on request. Tell us how many you need and our team will come back with a quotation.</p>',
            '</div>'
        ].filter(line => line !== '').join('\n');
    }

    // featured_description is the hero copy and `description` the catalogue
    // blurb. Never print the same sentence twice: the lede is whichever exists,
    // and `description` only earns the block below when it says something else.
    function ledeOf(row) {
        const featured = String(row.featured_description || '').trim();
        const plain = String(row.description || '').trim();
        return featured || plain;
    }

    function detailOf(row) {
        const featured = String(row.featured_description || '').trim();
        const plain = String(row.description || '').trim();
        return (featured && plain && featured !== plain) ? plain : '';
    }

    // The cart's stepper, with two deliberate differences. The attributes are
    // data-details-* not data-cart-*, so the two delegations can never read
    // each other's markup. And the buttons are never `disabled` at the bounds:
    // the cart disables `−` at 1 because the next press would *remove a line*,
    // where here it would do nothing — and a button that goes disabled under
    // the pointer drops out of the trap's FOCUSABLE list, stranding focus.
    function stepperHTML(row) {
        return [
            '<div class="flex items-center gap-4">',
            '    <label for="product-details-qty" class="text-sm font-semibold text-[#1f271b]">Quantity</label>',
            '    <div class="flex items-center gap-1.5">',
            '        <button type="button" class="' + STEP_CLASSES + '" data-details-action="decrease" aria-label="Reduce quantity">' + MINUS_ICON + '</button>',
            '        <input autocomplete="srk-no-autofill" spellcheck="false" type="text" inputmode="numeric"',
            '               id="product-details-qty" data-details-qty value="' + quantity + '"',
            '               aria-label="Quantity"',
            '               class="details-qty-input w-12 h-9 text-center text-sm font-bold text-[#12170f] bg-white border border-[#12170f]/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-[#d4af37]" />',
            '        <button type="button" class="' + STEP_CLASSES + '" data-details-action="increase" aria-label="Increase quantity">' + PLUS_ICON + '</button>',
            '    </div>',
            '</div>',
            totalHTML(row)
        ].filter(line => line !== '').join('\n');
    }

    // Said only when the price is a number. products.price is `text` upstream
    // and "On request" is legal, so a total that cannot be worked out is not
    // shown at all rather than shown as zero.
    function totalHTML(row) {
        const unit = readPrice(row);
        if (unit === null) return '';

        return '<p id="product-details-total" class="text-sm text-[#1f271b]/60 mt-3">Total <span class="font-bold text-[#12170f]">' +
            escapeHtml(formatMoney(unit * quantity)) + '</span></p>';
    }

    function readPrice(row) {
        return typeof window.parseProductPrice === 'function' ? window.parseProductPrice(row.price) : null;
    }

    function formatMoney(value) {
        return typeof window.formatAmount === 'function' ? window.formatAmount(value) : String(value);
    }

    // Gold Buy Now / white Add to Cart matches the card's own hierarchy, where
    // Buy Now is the gold button and the bag icon is the quiet add.
    //
    // The two token strings do not make equal boxes on their own — PRIMARY is
    // text-base px-8 py-3.5 and SECONDARY is text-sm px-6 py-3 — so side by
    // side at flex-1 they would render at different heights and font sizes.
    // Equalised by appending, the way request-quote-module.js already appends
    // to these tokens.
    // An unpriced product gets one button where a priced one gets two, the
    // same split the card in product-section-shared-module.js makes and by the
    // same test — section.isPurchasable, which is also priceCheckout()'s rule.
    // Neither Add to Cart nor Buy Now can succeed without a price, so offering
    // them here would repeat on the detail page exactly the dead end the card
    // no longer walks the customer into.
    //
    // It reuses #product-details-to-quote rather than introducing a second
    // control: that id already has a handler which captures this product AND
    // the quantity currently in the stepper before closing, so a customer who
    // asked for six of something is quoted for six.
    function ctasHTML(row) {
        if (!isPurchasable(row)) {
            return [
                '<div class="flex mt-7">',
                '    <button type="button" id="product-details-to-quote"',
                '            class="' + PRIMARY_BUTTON_CLASSES + ' flex-1 px-6">Request a price</button>',
                '</div>'
            ].join('\n');
        }

        return [
            '<div class="flex flex-col sm:flex-row gap-3 mt-7">',
            '    <button type="button" data-details-action="add" id="product-details-add"',
            '            class="' + SECONDARY_BUTTON_CLASSES + ' flex-1 text-base py-3.5">Add to Cart</button>',
            '    <button type="button" data-details-action="buy" id="product-details-buy"',
            '            class="' + PRIMARY_BUTTON_CLASSES + ' flex-1 px-6">Buy Now</button>',
            '</div>'
        ].join('\n');
    }

    function bodyHTML(row) {
        const detail = detailOf(row);

        return [
            '<div class="' + DETAILS_SHELL + ' py-8 md:py-10">',
            '    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">',
            '        ' + galleryHTML(row),
            '        ' + buyHTML(row),
            '    </div>',
            detail
                ? '    <div class="mt-10 pt-8 border-t border-[#12170f]/10 max-w-3xl">' +
                  '<h3 class="text-lg font-bold tracking-tight text-[#12170f] mb-3">Product Details</h3>' +
                  '<p class="text-base text-[#1f271b]/70 leading-relaxed whitespace-pre-line">' + escapeHtml(detail) + '</p></div>'
                : '',
            '</div>'
        ].filter(line => line !== '').join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — footer rail
    // ------------------------------------------------------------------
    function chipHTML(tab) {
        const on = tab.key === railTab;

        return [
            '<button type="button" data-details-rail="' + escapeHtml(tab.key) + '"',
            '        class="' + PILL_CLASSES + ' ' + (on ? 'bg-gray-50 border-[#d4af37]/30' : 'border-[#12170f]/10') + '"',
            '        aria-pressed="' + (on ? 'true' : 'false') + '">',
            '    ' + tickIcon(on),
            '    <span class="font-semibold">' + escapeHtml(tab.label) + '</span>',
            '</button>'
        ].join('\n');
    }

    // Pinned at every size; the tile is compact so the region costs ~150px on
    // a phone and ~180px at md+. Unpinning below md was considered and
    // rejected: a node cannot move between footerEl and body in CSS, so it
    // would need a matchMedia re-render that either drops the typed quantity
    // and the gallery index or needs a state-preservation path built for a
    // case with no other reason to exist — and it would remove the pinned rail
    // on exactly the device most likely to be holding it.
    function footerHTML() {
        return [
            // pb picks up the iOS home-indicator inset; inert everywhere else.
            '<div class="shrink-0 border-t border-[#12170f]/10 bg-white pb-[env(safe-area-inset-bottom)]">',
            '    <div class="' + DETAILS_SHELL + ' py-4 md:py-5">',
            '        <div class="flex items-center justify-between gap-4 mb-3 md:mb-4">',
            '            <div id="product-details-chips" class="flex items-center gap-2 overflow-x-auto no-scrollbar">',
            '                ' + ACTIVE_RAIL_TABS.map(chipHTML).join('\n                '),
            '            </div>',
            // Hidden on touch, where the rail is dragged directly.
            '            <div class="hidden sm:flex items-center gap-2 shrink-0">',
            '                <button type="button" data-details-action="rail-prev" class="' + RAIL_NAV_CLASSES + '" aria-label="Scroll left">' + LEFT_ICON + '</button>',
            '                <button type="button" data-details-action="rail-next" class="' + RAIL_NAV_CLASSES + '" aria-label="Scroll right">' + RIGHT_ICON + '</button>',
            '            </div>',
            '        </div>',
            '        <div id="product-details-rail" class="flex overflow-x-auto snap-x snap-mandatory no-scrollbar gap-3 md:gap-4 scroll-smooth"></div>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    // Rendered as an inert <div> while `item.id` is null, which is what every
    // sample tile is today. That is deliberate, not laziness: an
    // <article data-product-id> here would be matched by cart-module.js's
    // delegated listener *and* by this file's own, and both would go looking
    // in the catalogue for a product that does not exist. store.html's four
    // hardcoded home-view demo cards are inert for exactly this reason. When
    // loadRail() returns real rows with ids, the tag flips and both listeners
    // light up with no further wiring.
    function railCardHTML(item) {
        const tag = item.id ? 'article' : 'div';
        const attr = item.id ? ' data-product-id="' + escapeHtml(item.id) + '"' : '';

        return [
            '<' + tag + attr + ' class="snap-start shrink-0 w-[248px] md:w-[280px] flex items-center gap-3 bg-white border border-[#12170f]/10 rounded-sm p-2 md:p-2.5 hover:border-[#d4af37]/40 hover:shadow-sm transition-all' + (item.id ? '' : ' select-none') + '">',
            '    <div class="relative w-14 h-14 md:w-16 md:h-16 shrink-0 bg-[#f1f5f9] rounded-sm flex items-center justify-center p-1.5 overflow-hidden">',
            '        ' + railMediaHTML(item),
            '    </div>',
            '    <div class="min-w-0 flex flex-col gap-0.5">',
            '        <span class="text-[11px] text-[#1f271b]/50 truncate">' + escapeHtml(item.category_name || '') + '</span>',
            // Two lines' worth of height whether the name needs one or two.
            // Without it the rail — and so the pinned footer above it — grew
            // and shrank as you switched tabs, because "Frame Master + V-Nail
            // Starter Set" wraps and "Trim Craft" does not. line-clamp-2 caps
            // the tall case; min-h is what pads the short one.
            '        <h3 class="text-sm font-bold text-[#1f271b] leading-snug line-clamp-2 min-h-[2.75em]">' + escapeHtml(item.name || '') + '</h3>',
            '        <span class="text-xs font-bold text-[#d4af37]">' + escapeHtml(formatPrice(item.price) || 'Price on request') + '</span>',
            '    </div>',
            '</' + tag + '>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — states
    // ------------------------------------------------------------------
    function loadingHTML() {
        return centredMessageHTML('<p class="text-sm text-[#1f271b]/50">Loading product…</p>');
    }

    function errorHTML() {
        return centredMessageHTML(
            '<p class="text-base font-bold text-[#12170f] mb-2">That did not load.</p>' +
            '<p class="text-sm text-[#1f271b]/60 mb-6">The catalogue could not be reached.</p>' +
            '<button type="button" id="product-details-retry" class="' + SECONDARY_BUTTON_CLASSES + '">Retry</button>'
        );
    }

    function missingHTML() {
        return centredMessageHTML(
            '<p class="text-base font-bold text-[#12170f] mb-2">This product is no longer available.</p>' +
            '<p class="text-sm text-[#1f271b]/60 mb-6">It may have been withdrawn since this page was loaded.</p>' +
            '<button type="button" id="product-details-dismiss" class="' + SECONDARY_BUTTON_CLASSES + '">Back to the store</button>'
        );
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    function paintHeading(row) {
        if (!handle) return;
        const slot = handle.node.querySelector('#product-details-heading');
        if (slot) slot.innerHTML = headingHTML(row);
    }

    async function paint(productId) {
        if (!handle) return;

        // Clicking two rail tiles quickly must not let the first paint land
        // last. Same guard, same reason, as the search overlay's.
        const mine = ++token;

        handle.body.innerHTML = loadingHTML();
        paintHeading(null);

        let products;
        try {
            products = await section.loadProducts();
        } catch (error) {
            if (!handle || mine !== token) return;
            console.warn('Product details: could not read the catalogue.', error);
            handle.body.innerHTML = errorHTML();
            paintRail();
            return;
        }

        if (!handle || mine !== token) return;

        const found = products.find(entry => String(entry.id) === String(productId)) || null;

        if (!found) {
            product = null;
            gallery = [];
            handle.body.innerHTML = missingHTML();
            paintHeading(null);
            paintRail();
            return;
        }

        product = found;
        gallery = imagesOf(found);
        activeImage = startIndexOf(found, gallery);
        quantity = 1;

        paintHeading(found);
        handle.body.innerHTML = bodyHTML(found);

        // enhance(handle.node), never handle.body — the footer is a sibling of
        // body, so scoping to body would miss anything the rail ever grows.
        enhance(handle.node);

        paintRail();
    }

    async function paintRail() {
        if (!handle || !handle.footerEl) return;

        const rail = handle.footerEl.querySelector('#product-details-rail');
        if (!rail) return;

        const items = await loadRail(product ? product.id : null, railTab);
        if (!handle) return;

        rail.innerHTML = items.length
            ? items.map(railCardHTML).join('\n')
            : '<p class="text-sm text-[#1f271b]/40 italic py-6">Nothing to show here yet.</p>';

        rail.scrollLeft = 0;
    }

    function paintChips() {
        if (!handle || !handle.footerEl) return;
        const slot = handle.footerEl.querySelector('#product-details-chips');
        if (slot) slot.innerHTML = ACTIVE_RAIL_TABS.map(chipHTML).join('\n');
    }

    function showImage(next) {
        if (!handle || gallery.length < 2) return;

        // The picture under the lens is about to be a different picture.
        hideLens();

        // Wrap rather than disable at the ends: a disabled button drops out of
        // the trap's FOCUSABLE list, so a keyboard visitor stepping to the last
        // image would have the control they are standing on vanish.
        activeImage = (next + gallery.length) % gallery.length;

        // Rebuild the subtree rather than swapping img.src. If an earlier image
        // 404'd, the onerror above already set display:none on the <img> and
        // revealed the stand-in — a new src on a hidden <img> would load
        // invisibly behind a stand-in that then reads as a watermark.
        const stage = handle.node.querySelector('#product-details-stage .details-media');
        if (stage && product) stage.innerHTML = mediaHTML(product);

        const counter = handle.node.querySelector('#product-details-counter');
        if (counter) counter.textContent = (activeImage + 1) + ' / ' + gallery.length;

        handle.node.querySelectorAll('[data-details-image]').forEach(btn => {
            const on = Number(btn.getAttribute('data-details-image')) === activeImage;
            btn.setAttribute('aria-current', on ? 'true' : 'false');
            btn.classList.toggle('border-[#d4af37]', on);
            btn.classList.toggle('border-[#12170f]/10', !on);
            btn.classList.toggle('hover:border-[#d4af37]/60', !on);
        });
    }

    // ------------------------------------------------------------------
    // RENDER — magnifier
    // ------------------------------------------------------------------
    // object-contain letterboxes the picture inside the <img> box, so the
    // rectangle actually painted is not the element's rectangle — and every
    // product here is a different shape inside a fixed square stage. Zooming
    // against the element box would drift further off-target the more the two
    // disagree, which on a tall part is most of the frame.
    function drawnRect(img) {
        const w = img.clientWidth;
        const h = img.clientHeight;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!w || !h || !nw || !nh) return null;

        const scale = Math.min(w / nw, h / nh);
        const dw = nw * scale;
        const dh = nh * scale;

        return { left: (w - dw) / 2, top: (h - dh) / 2, width: dw, height: dh };
    }

    function hideLens() {
        if (!handle) return;
        const lens = handle.node.querySelector('#product-details-lens');
        if (lens) lens.classList.remove('is-on');
    }

    function moveLens(event) {
        if (!handle) return;

        const stage = handle.node.querySelector('#product-details-stage');
        const lens = handle.node.querySelector('#product-details-lens');
        const inner = lens && lens.firstElementChild;
        const img = stage && stage.querySelector('.details-media img');
        if (!stage || !lens || !inner || !img) return;

        // A 404'd image is display:none with the stand-in showing in its
        // place — there is nothing to magnify, and its natural size is 0.
        const rect = img.style.display === 'none' ? null : drawnRect(img);
        if (!rect) { hideLens(); return; }

        const box = img.getBoundingClientRect();
        const x = event.clientX - box.left - rect.left;
        const y = event.clientY - box.top - rect.top;

        // Outside the painted picture: the stage padding and the letterbox
        // either side of it are flat background, and magnifying those reads
        // as a bug rather than a feature.
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) { hideLens(); return; }

        const src = img.currentSrc || img.getAttribute('src') || '';
        if (inner.getAttribute('data-src') !== src) {
            inner.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
            inner.setAttribute('data-src', src);
        }

        inner.style.backgroundSize = (rect.width * LENS_ZOOM) + 'px ' + (rect.height * LENS_ZOOM) + 'px';
        // Put the scaled point under the middle of the lens, which is what
        // "centred on the cursor" means once the image is LENS_ZOOM times
        // bigger than the one being pointed at.
        inner.style.backgroundPosition =
            (LENS_SIZE / 2 - x * LENS_ZOOM) + 'px ' + (LENS_SIZE / 2 - y * LENS_ZOOM) + 'px';

        const stageBox = stage.getBoundingClientRect();
        lens.style.left = (event.clientX - stageBox.left - LENS_SIZE / 2) + 'px';
        lens.style.top = (event.clientY - stageBox.top - LENS_SIZE / 2) + 'px';
        lens.classList.add('is-on');
    }

    // Updates in place. Repainting the body would reset its scrollTop and the
    // gallery index along with it.
    function setQuantity(value) {
        if (!handle) return;

        quantity = clampQuantity(value);

        const field = handle.node.querySelector('[data-details-qty]');
        if (field && field.value !== String(quantity)) field.value = String(quantity);

        const total = handle.node.querySelector('#product-details-total');
        if (!total || !product) return;

        const unit = readPrice(product);
        if (unit !== null) {
            total.innerHTML = 'Total <span class="font-bold text-[#12170f]">' +
                escapeHtml(formatMoney(unit * quantity)) + '</span>';
        }
    }

    function scrollRail(direction) {
        if (!handle || !handle.footerEl) return;
        const rail = handle.footerEl.querySelector('#product-details-rail');
        if (!rail) return;

        rail.scrollBy({
            left: direction * Math.max(rail.clientWidth - 48, 200),
            behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        });
    }

    // A local copy of the cart's confirm flash — that function is module
    // private there. On a text button the label is what changes, not a glyph.
    const CONFIRM_MS = 1100;

    function confirmOn(button) {
        if (!button || button.dataset.detailsBusy === '1') return;

        const original = button.textContent;
        button.dataset.detailsBusy = '1';
        button.textContent = 'Added to Cart';

        window.setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = original;
            delete button.dataset.detailsBusy;
        }, CONFIRM_MS);
    }

    async function submit(thenOpenCart) {
        if (!product || !window.storeCart) return;

        const add = handle.node.querySelector('#product-details-add');
        const buy = handle.node.querySelector('#product-details-buy');

        // storeCart.add() is async — it re-reads the catalogue — so two fast
        // presses would add twice. The pair is locked for the round trip.
        [add, buy].forEach(button => { if (button) button.disabled = true; });

        const added = await window.storeCart.add(product.id, quantity);

        [add, buy].forEach(button => { if (button && button.isConnected) button.disabled = false; });

        // false means the product left the catalogue between the paint and the
        // press. Say so rather than silently doing nothing.
        if (!added) { paint(product.id); return; }

        if (!thenOpenCart) { confirmOn(add); return; }

        // Buy Now is the whole intent, so it continues directly to checkout.
        close();
        if (typeof window.storeCart.flush === 'function') await window.storeCart.flush();
        window.location.assign('/store/checkout.html');
    }

    // ------------------------------------------------------------------
    // WIRING
    // ------------------------------------------------------------------
    // One delegated trio on the overlay node, bound once. So the answer to
    // "what must be re-wired after an innerHTML repaint" is: nothing — with
    // the single exception of the close button, which openOverlay binds
    // directly and which is why only #product-details-heading is repainted
    // rather than the whole <header>.
    function wire(node) {
        // Delegated like the click handler, and for the same reason: paint()
        // replaces the whole scroll body, so anything bound to the stage
        // itself would be dropped on the next render.
        node.addEventListener('pointermove', (event) => {
            // A pen or a finger has no hover to track, and the lens would
            // only ever sit under the thing summoning it.
            if (event.pointerType && event.pointerType !== 'mouse') return;

            const target = event.target;
            if (!target || !target.closest) return;

            // The arrows and the counter sit inside the stage at z-10; the
            // lens is z-20 and would cover the control being reached for.
            if (!target.closest('#product-details-stage') || target.closest('button')) {
                hideLens();
                return;
            }

            moveLens(event);
        });

        // pointermove alone cannot catch the pointer leaving the overlay
        // entirely — the last event inside it is still inside it.
        node.addEventListener('pointerleave', hideLens);

        node.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;

            const thumb = target.closest('[data-details-image]');
            if (thumb) { showImage(Number(thumb.getAttribute('data-details-image'))); return; }

            const chip = target.closest('[data-details-rail]');
            if (chip) {
                railTab = chip.getAttribute('data-details-rail');
                paintChips();
                paintRail();
                return;
            }

            if (target.closest('#product-details-retry')) { paint(currentId); return; }
            if (target.closest('#product-details-dismiss')) { close(); return; }
            if (target.closest('#product-details-to-quote')) {
                // close() clears the module state synchronously, so capture the
                // exact selection before handing control to the quote overlay.
                const quotedProduct = product;
                const quotedQuantity = quantity;
                window.srkPendingQuoteItems = quotedProduct
                    ? [{ product_id: quotedProduct.id, quantity: quotedQuantity }]
                    : [];
                close();
                if (window.requestQuote && quotedProduct) {
                    window.requestQuote.open({ items: [{ product_id: quotedProduct.id, quantity: quotedQuantity }] });
                }
                return;
            }

            const action = target.closest('[data-details-action]');
            if (!action) return;

            switch (action.getAttribute('data-details-action')) {
                case 'prev-image': showImage(activeImage - 1); break;
                case 'next-image': showImage(activeImage + 1); break;
                case 'decrease': setQuantity(quantity - 1); break;
                case 'increase': setQuantity(quantity + 1); break;
                case 'rail-prev': scrollRail(-1); break;
                case 'rail-next': scrollRail(1); break;
                case 'add': submit(false); break;
                case 'buy': submit(true); break;
            }
        });

        // Committed on change and Enter, never per keystroke: typing "12" would
        // otherwise be read as a 1 the moment the first key landed.
        node.addEventListener('change', (event) => {
            const field = event.target.closest && event.target.closest('[data-details-qty]');
            if (field) setQuantity(field.value);
        });

        node.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const field = event.target.closest && event.target.closest('[data-details-qty]');
            if (!field) return;
            event.preventDefault();
            setQuantity(field.value);
        });
    }

    // ------------------------------------------------------------------
    // LIFECYCLE
    // ------------------------------------------------------------------
    function open(productId) {
        currentId = productId;

        // Re-paint rather than stacking a second overlay on itself.
        if (handle) { railTab = defaultRailTab(); paint(productId); paintChips(); return; }

        railTab = defaultRailTab();

        handle = chrome.openOverlay({
            id: 'product-details',
            titleId: 'product-details-title',
            closeId: 'product-details-close',
            header: headerHTML(),
            footer: true,
            onClose: () => {
                handle = null;
                product = null;
                gallery = [];
                currentId = null;
                if (escapeGuard) {
                    window.removeEventListener('keydown', escapeGuard, true);
                    escapeGuard = null;
                }
            }
        });

        handle.footerEl.innerHTML = footerHTML();
        wire(handle.node);
        armEscapeGuard();

        // openOverlay does not move focus, and clicking an <article> does not
        // focus it, so activeElement would still be <body>. The trap only
        // intervenes when focus is on the first or last control *inside* the
        // node, so from <body> the first Tab would walk into the sidebar
        // behind the overlay. The header exists immediately, before the async
        // paint, so the close button is always there to take it.
        const closeButton = handle.node.querySelector('#product-details-close');
        if (closeButton) closeButton.focus({ preventScroll: true });

        paint(productId);
    }

    // Escape, with two overlays stacked, would otherwise close both: the
    // shared trap registers one document-capture keydown per surface and calls
    // neither stopPropagation nor stopImmediatePropagation, and capture
    // listeners on the same node run in registration order — so the surface
    // *underneath* runs first. `window` precedes `document` in the capture
    // path, so a guard here runs before every trap regardless of order, and
    // stops the key ever reaching them. (The same latent bug affects
    // cart-over-search; the general fix is an open-stack in the shared module.)
    function armEscapeGuard() {
        escapeGuard = (event) => {
            if (event.key !== 'Escape' || !handle) return;

            // An open dropdown owns the key, exactly as the shared trap has it.
            if (handle.node.querySelector('.srk-select__trigger[aria-expanded="true"]')) return;

            event.stopPropagation();
            event.preventDefault();
            close();
        };

        window.addEventListener('keydown', escapeGuard, true);
    }

    function close() {
        if (handle) handle.close();
    }

    // ------------------------------------------------------------------
    // TRIGGER
    // ------------------------------------------------------------------
    function attach() {
        // In attach(), not open(): the cursor:pointer affordance has to exist
        // before the first card is ever clicked.
        ensureStyles(STYLE_ID, CSS);

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;

            const card = target.closest('article[data-product-id]');
            if (!card) return;

            // cart-module.js owns these two buttons through its own delegated
            // capture listener on document. It calls stopPropagation(), which
            // stops the event reaching other *nodes* — it does not stop other
            // listeners already registered on document; that would need
            // stopImmediatePropagation, which it does not call. So this
            // listener still fires on a Buy Now click, and the guard has to be
            // explicit: without it, Buy Now would add to the cart, open the
            // drawer AND open this overlay underneath it.
            // .request-price-btn is here for the same reason: it replaces the
            // other two on an unpriced card and is owned by
            // request-quote-module.js, which opens the quote form. Without
            // this, that click would open the quote form AND this overlay
            // behind it.
            if (target.closest('.cart-icon-btn, .buy-now-btn, .request-price-btn')) return;

            const id = card.getAttribute('data-product-id');
            if (!id) return;

            event.preventDefault();
            open(id);
        }, true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();

    window.productDetails = {
        open,
        close,
        isOpen: () => !!handle
    };
})();
