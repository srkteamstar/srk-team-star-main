/**
 * request-quote-module.js
 *
 * The store's "Request a Quote" full-viewport takeover.
 *
 * The sidebar has carried a `data-policy="quote"` button since the store page was
 * built, wired to nothing but the active-state class swap. This file gives it a
 * destination without giving it a page: an overlay over the store, in the store's
 * own palette, type and controls, so a visitor never loses their place in the
 * catalogue to ask what something costs.
 *
 * WHY AN OVERLAY AND NOT A #dynamic-view SECTION
 * ----------------------------------------------
 * Every other sidebar button swaps the contents of #dynamic-view. This one does
 * not, for two reasons: the form is a task rather than a view — leaving it half
 * filled by clicking "Featured" should not be a click away — and the search row,
 * profile and cart above #dynamic-view are catalogue controls that mean nothing
 * while a quote is being written. `profile-icon-loader.js` already establishes
 * the page's overlay pattern (`fixed inset-0`, body scroll locked, a 300ms fade);
 * this follows it rather than inventing a second one.
 *
 * Because the button opens an overlay instead of swapping a section, it is listed
 * in store.html's `data-skip` for view-state-restore-module.js. Otherwise a
 * refresh would replay the click and reopen an empty form on top of the page the
 * visitor actually wanted back — and, since the replay re-saves nothing, would do
 * it again on the next refresh. Skipping it also leaves the previously saved
 * section intact, so a refresh mid-quote returns to the shelf they came from.
 *
 * DATA
 * ----
 * No catalogue of its own. `window.productSection.loadProducts()` and
 * `.loadCategories()` are the same two cached promises the four product sections
 * read, so opening the quote form after browsing the store costs no request at
 * all, and the products offered here can never drift from the ones on the shelf.
 *
 * Categories are offered at root level first, via the same roll-up
 * `all-products-section-loader-module.js` uses for its filter tabs (the same
 * `rootOf` helper) — a customer asking for a quote is thinking "machinery",
 * not "machine spare parts". A root with children then grows a second select
 * the same shape as All Products' capsule: "Common" (the root's own direct
 * products) plus each child, narrowed with the same `subtreeKeys` helper so a
 * grandchild still counts. A childless root (e.g. "Machinery") behaves exactly
 * as it always has — no second select, every product filed on it.
 *
 * The two selects are deliberately separate DOM regions
 * (`.quote-subcategory-slot` / `.quote-grid-slot`), refreshed independently.
 * `custom-select-module.js`'s own click handler dispatches its `change` event
 * *before* calling `trigger.focus()` — replacing the DOM around the select
 * from within its own change handler would destroy the trigger the module is
 * about to focus, silently dropping focus to `<body>` mid-pick. Only the
 * category select's change ever rebuilds both slots (a new category may grow
 * or lose its sub-category select entirely); a sub-category change or a
 * product pick only ever touches the plain-button grid next to it.
 *
 * ONE PRODUCT PER REQUEST
 * -----------------------
 * Category stays a dropdown — the same custom-select-module instance it always
 * was. Product is a grid of clickable cards (image, name, price) once a category
 * narrows the catalogue down to something browsable; a name alone in a dropdown
 * list is not enough to tell two similar-looking machine parts apart, which is
 * the whole reason to offer a picture. It is a bespoke picker built only for this
 * field, not an extension of custom-select-module.js — that module backs every
 * other dropdown on the site (filters, this same category control), and giving
 * its options images would be a change with a much wider blast radius than one
 * form needs. Selecting a card sets the request's product exactly like picking
 * from a dropdown did — same state, same submission payload — only the picking
 * itself looks different. A new request defaults its category to "Machinery" —
 * the site's own top-level term for its core catalogue (see index.html's "Explore
 * Machinery" and crousel-and-data-module.js) — so the common case starts one
 * click closer to a product instead of an empty "Select a category".
 *
 * Several products means several requests, which is the shape "+ Add Another
 * Product" already implies and the shape the itemised message reads in.
 *
 * Picking the product is the last thing a request needs, so the request folds
 * itself away — after SELECT_FOLD_DELAY_MS, so a click on a card and the fold read as
 * one movement rather than a collision. The fold is a max-height transition that
 * ends in `hidden`: display:none is the resting collapsed state, which is what
 * keeps a folded request's fields out of the tab order and out of the focus
 * trap's first/last reckoning.
 *
 * Products whose category was deleted or deactivated appear under a trailing
 * "Other Products" group. All Products deliberately gives them no *tab* because
 * they are still reachable there under "All"; here a category is the only route
 * to a product, so the same rule would make them unquotable — a functional loss,
 * not a display choice.
 *
 * SUBMISSION
 * ----------
 * POSTs to POST /api/quote-requests, which writes `quote_requests` plus one
 * `quote_request_items` row per product request. Field for field:
 *
 *     business_name     ← Business Name
 *     contact_name      ← Contact Person
 *     email, phone      ← as entered (phone is text, so a +91 survives)
 *     business_address  ← Business Address
 *     notes             ← Additional Details
 *     items[]           ← { category_id, category_name, product_id,
 *                           product_name, product_price } per request
 *
 * This used to go to /api/submit-form as `form_type: 'quote'`, which meant the
 * address and every requested product were flattened into the one free-text
 * column `enquiries` has. Nothing downstream could read that back as structure —
 * the back office could only echo the blob under a heading that says "Issue". The
 * ids and the names are both sent: the ids so a quote can be joined back to the
 * catalogue, the names and price so the row still reads correctly after the
 * product is renamed, repriced or deleted. See
 * backend/migrations/009_quote_requests.sql.
 *
 * The confirmation screen's reference is prefixed `PI-` (proforma invoice —
 * the standard term for a priced pre-order document in B2B trade), not `QT-`.
 * server.js's quoteReference() and the back office's own fallback both changed
 * with it — the three must agree, since the number a customer reads here is
 * the one they quote back to staff. The screen also carries a Print button
 * that opens the browser's print surface, where the confirmation can be
 * printed or saved as a PDF without a second document generator.
 *
 * CHROME
 * ------
 * The design tokens, icon set, field markup, focus trap and overlay lifecycle
 * this file worked out first now live in store-overlay-shared-module.js, which
 * the cart drawer, the account overlay and the search overlay read too. Nothing
 * about the behaviour changed; only where the constants are declared. What is
 * still here is what is specific to a quote: the repeating request, the fold,
 * the catalogue roll-up and the submission.
 *
 * LOAD ORDER
 * ----------
 * After product-section-shared-module.js (for the catalogue and tree helpers),
 * store-overlay-shared-module.js (for the chrome above) and
 * custom-select-module.js (for the dropdowns), and before
 * view-state-restore-module.js, which must stay last on the page.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const section = window.productSection;
    if (!section) {
        console.error('request-quote-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('request-quote-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    if (window.requestQuote) return;

    const { escapeHtml, categoryKey, indexCategories, rootOf, subtreeKeys, UNCATEGORISED } = section;

    // Pulled into locals under their own names so the markup below reads the
    // same as it did when these were declared here.
    const {
        FIELD_CLASSES, PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, EYEBROW_CLASSES, SHELL,
        CHEVRON_ICON, TRASH_ICON, PLUS_ICON, CHECK_ICON,
        ensureStyles, prefersReducedMotion, enhance,
        sectionHeading, labelHTML, errorHTML, textFieldHTML, textAreaHTML, centredMessageHTML,
        fieldError, clearFieldError, syncSelectTrigger
    } = chrome;

    const ENDPOINT = '/api/quote-requests';

    const UNCATEGORISED_LABEL = 'Other Products';

    // The reference prefix shown on the confirmation screen and read back by
    // staff. "PI" — proforma invoice, the standard B2B term for a priced
    // pre-order document — not "QT". server.js's quoteReference() and
    // the back office's own fallback carry the same prefix; all three must agree.
    const REFERENCE_PREFIX = 'PI';

    // A new request's category defaults to this if a matching root category is
    // published, saving the common case a click. Matched by name, not id — the
    // site has no stable "this is the core catalogue" flag, and the name is
    // what "Machinery" already means everywhere else on the site (index.html's
    // "Explore Machinery", crousel-and-data-module.js). Case-insensitive so a
    // capitalisation change in the back office does not silently break it;
    // absent entirely, a request just starts unselected as it always did.
    const DEFAULT_CATEGORY_NAME = 'machinery';

    // Sentinel for "this category itself, not one of its children" in the
    // sub-category select a category-with-children grows. Not on
    // window.productSection — it is private to the capsule pattern
    // all-products-section-loader-module.js owns, and this file's own
    // DEFAULT_CATEGORY_NAME above is already the same kind of small,
    // precedented local copy rather than a shared export.
    const DIRECT_ONLY = '__direct__';

    // Small badge on a selected product card. Sized for an absolute-positioned
    // 24px circle, unlike CHECK_ICON (store-overlay-shared-module.js), which is
    // fixed at 28px for the confirmation screen's own icon.
    const CARD_CHECK_ICON = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';

    const PRINT_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v3h10z"></path></svg>';

    // Folding the request the instant a card is clicked would pull the ground
    // out from under the checkmark that just landed on it, so the fold waits
    // this long first — long enough to register as "selected, and now closing"
    // rather than "closing", short enough not to feel like a pause.
    const SELECT_FOLD_DELAY_MS = 160;

    // Matches the .quote-body transition in CSS above.
    const FOLD_MS = 300;

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    // The icon, chevron and select-width rules moved to
    // store-overlay-shared-module.js, which every store surface now injects.
    // What is left is the one thing only this file has: the fold.
    const STYLE_ID = 'request-quote-styles';

    const CSS = [
        /* The fold. Animated on max-height rather than a class swap so the
           request closing after a product is picked reads as one motion with
           the dropdown that just closed above it. JS sets the pixel values and
           puts `hidden` back at the end, so the resting collapsed state is
           still display:none — which is what keeps a folded request's fields
           out of the tab order and out of the focus trap's reckoning. */
        '.quote-body{transition:max-height 300ms ease-out,opacity 300ms ease-out;}',

        '@media (prefers-reduced-motion:reduce){',
        '.quote-body{transition:none;}',
        '}'
    ].join('');

    // ------------------------------------------------------------------
    // CATALOGUE
    // ------------------------------------------------------------------
    // [{ key, label, products: [...] }] — one entry per root category that has
    // products somewhere beneath it, name-ordered, uncategorised last.
    function buildGroups(products, index) {
        const groups = new Map();
        const orphans = [];

        products.forEach(product => {
            const key = categoryKey(product);

            if (key === UNCATEGORISED) {
                orphans.push(product);
                return;
            }

            const root = rootOf(index, key);
            const entry = index.byId.get(root);

            // A product filed under a category the public endpoint does not
            // publish — deactivated, or deleted since the product was saved.
            // It is still an active product, so it is still quotable.
            if (!entry) {
                orphans.push(product);
                return;
            }

            if (!groups.has(root)) {
                groups.set(root, { key: root, label: entry.name, children: index.children.get(root) || [], products: [] });
            }
            groups.get(root).products.push(product);
        });

        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

        const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
        if (orphans.length) ordered.push({ key: UNCATEGORISED, label: UNCATEGORISED_LABEL, children: [], products: orphans });

        ordered.forEach(group => group.products.sort(byName));

        return ordered;
    }

    function groupFor(key) {
        return state.groups.find(group => group.key === key) || null;
    }

    function productName(id) {
        const match = productById(id);
        return match ? String(match.name || '') : '';
    }

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    // A plain object, in the page's own idiom — no store, no framework. Every
    // render reads it and every handler writes it, so the DOM is never the
    // source of truth for anything that has to survive a re-render.
    let state = null;
    let overlay = null;
    // What store-overlay-shared-module.js hands back when the overlay opens:
    // { node, body, close }. Its presence is what "the form is open" means, and
    // closing it is the only way this module closes.
    let handle = null;
    let nextUid = 0;

    // See DEFAULT_CATEGORY_NAME above for why "Machinery" specifically.
    function defaultCategoryKey() {
        const groups = state && state.groups ? state.groups : [];
        const match = groups.find(group => group.label.trim().toLowerCase() === DEFAULT_CATEGORY_NAME);
        return match ? match.key : '';
    }

    function blankRequest() {
        nextUid += 1;
        return { uid: 'qr-' + nextUid, category: defaultCategoryKey(), subcategory: DIRECT_ONLY, product: '', quantity: 1 };
    }

    function productById(id) {
        return state.products.find(product => String(product.id) === String(id)) || null;
    }

    function requestForProduct(item) {
        const product = productById(item && (item.product_id ?? item.id));
        if (!product) return null;
        const key = categoryKey(product);
        const root = rootOf(state.index, key);
        const request = blankRequest();
        request.category = root;
        request.subcategory = key === root ? DIRECT_ONLY : key;
        request.product = String(product.id);
        request.quantity = Math.max(1, Math.min(99, Number.parseInt(item && item.quantity, 10) || 1));
        return request;
    }

    // ------------------------------------------------------------------
    // MARKUP — QuoteHeader
    // ------------------------------------------------------------------
    // The section headings, labels, reserved error lines, text fields and text
    // areas below are store-overlay-shared-module.js's, destructured above.
    function headerHTML() {
        return chrome.headerHTML({
            titleId: 'quote-title',
            title: 'Request a Quote',
            subtitle: 'Tell us about your business and the products you need. Our team will review the request and contact you about pricing and availability.',
            closeId: 'quote-close',
            closeLabel: 'Close quote request'
        });
    }

    // ------------------------------------------------------------------
    // MARKUP — BusinessInformation
    // ------------------------------------------------------------------
    function businessHTML() {
        return [
            '<section class="mb-12">',
            '    ' + sectionHeading('01', 'Business Information'),
            '    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
            '        ' + textFieldHTML({ id: 'quote-business-name', label: 'Business Name', placeholder: 'Registered business name', required: true }),
            '        ' + textFieldHTML({ id: 'quote-contact-name', label: 'Contact Person', placeholder: 'Who should we reply to?', required: true }),
            '        ' + textFieldHTML({ id: 'quote-email', label: 'Email', type: 'email', placeholder: 'name@business.com', required: true }),
            '        ' + textFieldHTML({ id: 'quote-phone', label: 'Phone', type: 'tel', placeholder: 'Optional' }),
            '        <div class="md:col-span-2">',
            '            ' + textAreaHTML({ id: 'quote-business-address', label: 'Business Address', placeholder: 'Street, city, state and PIN code', rows: 3, required: true }),
            '        </div>',
            '    </div>',
            '</section>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — ProductRequest
    // ------------------------------------------------------------------
    function categorySelectHTML(request) {
        const options = ['<option value="">Select a category</option>'].concat(
            state.groups.map(group =>
                '<option value="' + escapeHtml(group.key) + '"' + (group.key === request.category ? ' selected' : '') + '>' +
                escapeHtml(group.label) + '</option>')
        ).join('');

        return [
            '<div class="srk-field">',
            '    ' + labelHTML(request.uid + '-category', 'Category', true),
            '    <select autocomplete="srk-no-autofill" id="' + request.uid + '-category" class="quote-category ' + FIELD_CLASSES + ' cursor-pointer">' + options + '</select>',
            '    ' + errorHTML(request.uid + '-category'),
            '</div>'
        ].join('\n');
    }

    // Grown only when the picked category has children, same trigger
    // all-products-section-loader-module.js uses for its capsule dropdown:
    // "Common" (this sentinel's label) is the parent's own direct products,
    // any child narrows to that child's whole subtree via subtreeKeys(). A
    // customer asking for a quote can now say "Blades" instead of getting
    // everything under Machine Spare Parts merged into one grid.
    function subcategorySelectHTML(request, group) {
        if (!group || !group.children.length) return '';

        const options = [
            '<option value="' + escapeHtml(DIRECT_ONLY) + '"' + (request.subcategory === DIRECT_ONLY ? ' selected' : '') + '>Common</option>'
        ].concat(
            group.children.map(child =>
                '<option value="' + escapeHtml(child.id) + '"' + (String(child.id) === String(request.subcategory) ? ' selected' : '') + '>' +
                escapeHtml(child.name) + '</option>')
        ).join('');

        return [
            '<div class="srk-field mb-5">',
            '    ' + labelHTML(request.uid + '-subcategory', 'Sub-category', false),
            '    <select autocomplete="srk-no-autofill" id="' + request.uid + '-subcategory" class="quote-subcategory ' + FIELD_CLASSES + ' cursor-pointer">' + options + '</select>',
            '</div>'
        ].join('\n');
    }

    // The single source of truth for what the grid shows. A childless group
    // (today's behaviour, unchanged) shows everything filed on it; a group
    // with children shows only its direct members on "Common", or a picked
    // child's whole subtree via subtreeKeys() — a grandchild still counts,
    // the same guarantee All Products' filter row makes.
    function productsFor(request) {
        const group = groupFor(request.category);
        if (!group) return [];
        if (!group.children.length) return group.products;

        if (request.subcategory === DIRECT_ONLY) {
            return group.products.filter(product => categoryKey(product) === group.key);
        }

        const keys = subtreeKeys(state.index, request.subcategory);
        return group.products.filter(product => keys.has(categoryKey(product)));
    }

    // One card per product, at the size a name-only dropdown row used to be —
    // image, name, price — so two similar-looking machine parts are actually
    // tellable apart while picking, not just after. Whole card is the button
    // (not a small control inside it), so a click anywhere on it selects.
    function productCardHTML(product, request) {
        const id = String(product.id);
        const selected = id === request.product;
        const name = escapeHtml(product.name);
        const imageUrl = section.resolveMainImage ? section.resolveMainImage(product) : (product.image_url || '');
        const price = section.formatPrice(product.price) || 'Price on request';

        // Same 404-safe swap product-section-shared-module.js's own card uses:
        // the name stand-in stays hidden behind a loaded image and only shows if
        // the URL actually fails, never through one.
        const media = imageUrl
            ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + name + '" loading="lazy"' +
              ' class="w-full h-full object-contain mix-blend-multiply"' +
              ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
              '\n<div class="absolute inset-4 items-center justify-center text-center text-[#12170f]/30 text-xs font-semibold px-1" style="display:none">' + name + '</div>'
            : '<div class="absolute inset-4 flex items-center justify-center text-center text-[#12170f]/30 text-xs font-semibold px-1">' + name + '</div>';

        return [
            '<button type="button" data-product-id="' + escapeHtml(id) + '" aria-pressed="' + selected + '"',
            '        class="quote-product-card relative flex flex-col text-left bg-white border rounded-md overflow-hidden transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ' +
                (selected ? 'border-[#d4af37] ring-2 ring-[#d4af37]' : 'border-[#12170f]/15 hover:border-[#d4af37]/60 hover:shadow-md') + '">',
            selected
                ? '    <span class="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-[#d4af37] text-white flex items-center justify-center shadow-sm">' + CARD_CHECK_ICON + '</span>'
                : '',
            '    <div class="relative w-full h-[110px] shrink-0 bg-[#f1f5f9] flex items-center justify-center p-3 overflow-hidden">',
            '        ' + media,
            '    </div>',
            '    <div class="flex flex-col gap-0.5 px-3 py-2.5">',
            '        <span class="text-sm font-bold text-[#1f271b] leading-snug line-clamp-2">' + name + '</span>',
            '        <span class="text-xs font-bold text-[#d4af37]">' + escapeHtml(price) + '</span>',
            '    </div>',
            '</button>'
        ].join('\n');
    }

    // Until a category is picked there is nothing honest to offer, so the slot
    // says what to do next rather than showing an empty grid or, worse, the
    // whole catalogue. The grid itself scrolls internally past a handful of
    // rows rather than growing the request open-ended — a category with forty
    // products should not push "Add Another Product" off the visible form.
    function productPickerHTML(request) {
        const group = groupFor(request.category);

        if (!group) {
            return '<p class="text-sm text-[#1f271b]/40 italic py-3">Select a category to choose a product from it.</p>';
        }

        const products = productsFor(request);

        if (!products.length) {
            // A childless, genuinely empty category reads differently from
            // "Common" narrowing to nothing on a category whose products all
            // live under its children — the second one has a fix (pick a
            // child) the first one does not.
            const message = (group.children.length && request.subcategory === DIRECT_ONLY)
                ? 'No products are filed directly under ' + escapeHtml(group.label) + '. Choose a sub-category above.'
                : 'No products are published in this category yet.';
            return '<p class="text-sm text-[#1f271b]/40 italic py-3">' + message + '</p>';
        }

        const cards = products.map(product => productCardHTML(product, request)).join('\n');

        return [
            '<div>',
            '    ' + labelHTML(request.uid + '-product', 'Product', true),
            '    <div id="' + request.uid + '-product" tabindex="-1"',
            // srk-scroll: a scroller nested inside the quote overlay, which is
            // itself inside one. Running past the end of this grid used to be
            // offered to the overlay's own scroller and then to the store
            // behind it — see scroll-lock-module.js.
            '         class="quote-product-grid srk-scroll grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 border border-[#12170f]/25 rounded-md bg-[#f1f5f9] max-h-[380px] overflow-y-auto">',
            cards,
            '    </div>',
            '    ' + errorHTML(request.uid + '-product'),
            '</div>'
        ].join('\n');
    }

    // The collapsed summary is what makes a list of requests readable, so it has
    // to say enough to identify the request without being opened.
    function summaryText(request) {
        const group = groupFor(request.category);
        if (!group) return 'Not yet selected';
        if (!request.product) return group.label;

        return group.label + ' · ' + productName(request.product) + ' · Qty ' + request.quantity;
    }

    // Two independently-refreshable slots inside .quote-products, not one
    // wholesale block. custom-select-module's own click handler dispatches a
    // synchronous change event and only afterward calls trigger.focus() —
    // replacing the DOM around the subcategory select from within its own
    // change handler would destroy the trigger the module is about to focus,
    // silently dropping focus to <body> mid-interaction. Keeping the select
    // in its own slot means a subcategory change only ever touches the
    // plain-button grid next to it, never the select itself.
    function productSectionHTML(request) {
        const group = groupFor(request.category);

        return [
            '<div class="quote-subcategory-slot">' + subcategorySelectHTML(request, group) + '</div>',
            '<div class="quote-grid-slot">' + productPickerHTML(request) + '</div>',
            '<div class="srk-field mt-5">',
            '    ' + labelHTML(request.uid + '-quantity', 'Quantity', true),
            '    <input autocomplete="srk-no-autofill" id="' + request.uid + '-quantity" class="quote-quantity ' + FIELD_CLASSES + '" type="number" inputmode="numeric" min="1" max="99" step="1" value="' + request.quantity + '" />',
            '    ' + errorHTML(request.uid + '-quantity'),
            '</div>'
        ].join('\n');
    }

    function requestHTML(request, position) {
        const title = 'Product Request #' + position;

        return [
            '<article class="quote-request border border-[#12170f]/10 rounded-sm bg-white" data-uid="' + escapeHtml(request.uid) + '">',
            '    <div class="flex items-center gap-2 pl-5 pr-3 py-3">',
            '        <button type="button" class="quote-toggle flex-1 min-w-0 flex items-center gap-3 text-left py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-sm" aria-expanded="true" aria-controls="' + escapeHtml(request.uid) + '-body">',
            '            ' + CHEVRON_ICON,
            '            <span class="quote-request-title text-sm font-bold text-[#12170f] whitespace-nowrap">' + escapeHtml(title) + '</span>',
            '            <span class="quote-summary text-sm text-[#1f271b]/50 truncate">' + escapeHtml(summaryText(request)) + '</span>',
            '        </button>',
            '        <button type="button" class="quote-remove store-icon store-icon--danger w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]" aria-label="Remove ' + escapeHtml(title) + '">',
            '            ' + TRASH_ICON,
            '        </button>',
            '    </div>',
            // The padding sits on the inner wrapper, not on .quote-body: the fold
            // animates .quote-body's max-height to zero, and padding on the
            // animated element itself would leave a 40px stub behind at the end.
            '    <div class="quote-body" id="' + escapeHtml(request.uid) + '-body">',
            '        <div class="px-5 pb-5 pt-5 border-t border-[#12170f]/10">',
            '            ' + categorySelectHTML(request),
            '            <div class="quote-products mt-5">',
            '                ' + productSectionHTML(request),
            '            </div>',
            '        </div>',
            '    </div>',
            '</article>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — ProductRequestList + AddProductButton
    // ------------------------------------------------------------------
    function requestsHTML() {
        return [
            '<section class="mb-12">',
            '    ' + sectionHeading('02', 'Product Requests', 'Add as many as you need'),
            '    <div id="quote-requests" class="flex flex-col gap-4"></div>',
            '    <button type="button" id="quote-add" class="mt-4 w-full store-icon flex items-center justify-center gap-2 px-5 py-3.5 rounded-sm border border-[#12170f]/10 bg-white text-sm font-bold text-[#12170f] hover:border-[#d4af37] hover:text-[#d4af37] hover:bg-[#d4af37]/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">',
            '        ' + PLUS_ICON,
            '        <span>Add Another Product</span>',
            '    </button>',
            '</section>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — QuoteSubmit
    // ------------------------------------------------------------------
    function submitHTML() {
        return [
            '<section class="mb-4">',
            '    ' + sectionHeading('03', 'Additional Details', 'Optional'),
            '    ' + textAreaHTML({ id: 'quote-notes', label: 'Requirements & Quantities', placeholder: 'Quantities, specifications, delivery timelines or anything else we should know.', rows: 4 }),
            '</section>',
            // The failure banner is the shape enquiries.js already uses for a
            // failed fetch, so an error on the storefront and an error in the
            // dashboard look like the same product reporting the same problem.
            '<div id="quote-form-error" class="hidden mb-5 p-4 bg-red-50 text-red-700 rounded-sm border border-red-200 text-sm font-semibold"></div>'
        ].join('\n');
    }

    // Sticky, so on a phone the CTA is on screen no matter how many requests have
    // been added — the same trick the back office forms use for their save bar.
    function footerHTML() {
        return [
            '<div class="sticky bottom-0 z-10 bg-white border-t border-[#12170f]/10">',
            '    <div class="' + SHELL + ' py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">',
            '        <p id="quote-footer-note" class="text-xs text-[#1f271b]/50">Fields marked <span class="text-[#d4af37]">*</span> are required.</p>',
            '        <button type="submit" id="quote-submit" class="' + PRIMARY_BUTTON_CLASSES + ' w-full sm:w-auto">Submit Quote Request</button>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — states
    // ------------------------------------------------------------------
    function loadingHTML() {
        return centredMessageHTML('<p class="text-[#1f271b]/50 font-semibold">Loading the catalogue…</p>');
    }

    function catalogueErrorHTML() {
        return centredMessageHTML([
            '<p class="text-[#1f271b]/50 font-semibold mb-4">Could not load the catalogue. Check your connection and try again.</p>',
            '<button type="button" id="quote-retry" class="text-sm font-bold text-[#d4af37] hover:underline">Retry</button>'
        ].join('\n'));
    }

    function emptyCatalogueHTML() {
        return centredMessageHTML([
            '<p class="text-[#1f271b]/50 font-semibold mb-4">No products are published yet, so there is nothing to quote for.</p>',
            '<p class="text-sm text-[#1f271b]/50">Reach us on the <a href="/contact.html" class="font-bold text-[#d4af37] hover:underline">contact page</a> and we will help directly.</p>'
        ].join('\n'));
    }

    // Fallback for the reference the server normally sends back. Same format —
    // PI-<year>-<id>, the row's own primary key — so the number a customer quotes
    // back is the row staff will find. Only the year can differ from the server's,
    // and only for a request submitted across a new year's midnight. server.js's
    // quoteReference() and the back office's own fallback carry the same prefix.
    function referenceFor(id) {
        if (id === null || id === undefined || id === '') return '';

        const digits = String(id).replace(/\D/g, '');
        if (!digits) return '';

        return REFERENCE_PREFIX + '-' + new Date().getFullYear() + '-' + digits.padStart(4, '0');
    }

    function successHTML(reference) {
        return centredMessageHTML([
            '<div class="w-14 h-14 mx-auto mb-6 rounded-full bg-[#d4af37]/10 flex items-center justify-center text-[#d4af37]">',
            '    ' + CHECK_ICON,
            '</div>',
            '<h3 class="text-2xl font-bold tracking-tight text-[#12170f] mb-3">Quote request received</h3>',
            '<p class="text-sm text-[#1f271b]/60 max-w-md mx-auto mb-8">Our team will review your requirements and contact you using the details supplied.</p>',
            reference
                ? '<div class="inline-flex flex-col items-center gap-1.5 px-8 py-5 border border-[#12170f]/10 rounded-sm bg-white mb-8">' +
                  '<span class="' + EYEBROW_CLASSES + '">Reference Number</span>' +
                  '<span class="text-xl font-bold tracking-tight text-[#12170f]">' + escapeHtml(reference) + '</span>' +
                  '</div>'
                : '<p class="text-sm text-[#1f271b]/50 mb-8">Quote your business name when following up and we will find your request.</p>',
            '<div class="flex flex-col sm:flex-row items-center justify-center gap-3">',
            '    <button type="button" id="quote-done" class="' + PRIMARY_BUTTON_CLASSES + '">Back to Store</button>',
            '    <button type="button" id="quote-print" class="' + SECONDARY_BUTTON_CLASSES + ' gap-2">' + PRINT_ICON + '<span>Print / Download PDF</span></button>',
            '</div>'
        ].filter(line => line !== '').join('\n'));
    }

    function formHTML() {
        return [
            '<form autocomplete="srk-no-autofill" id="quote-form" novalidate class="flex flex-col min-h-full">',
            '    <div class="' + SHELL + ' py-10 flex-1">',
            '        ' + businessHTML(),
            '        ' + requestsHTML(),
            '        ' + submitHTML(),
            '    </div>',
            '    ' + footerHTML(),
            '</form>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // FIELD ERRORS
    // ------------------------------------------------------------------
    // fieldError, clearFieldError and syncSelectTrigger are the shared
    // module's, destructured above. Only the sweep is scoped to this overlay.
    function clearAllErrors() {
        chrome.clearErrorsIn(overlay, 'quote-form-error');
    }

    // ------------------------------------------------------------------
    // RENDER — targeted, never wholesale
    // ------------------------------------------------------------------
    // Re-rendering the whole list on every change would throw away the enhanced
    // dropdowns mid-interaction and move focus out from under the visitor. Each
    // of these repaints the smallest region that actually changed.
    function elementFor(uid) {
        return overlay.querySelector('.quote-request[data-uid="' + uid + '"]');
    }

    function refreshSummary(request) {
        const node = elementFor(request.uid);
        const summary = node && node.querySelector('.quote-summary');
        if (summary) summary.textContent = summaryText(request);
    }

    // A root category change: the sub-category select itself may appear,
    // disappear or change its options, so the whole .quote-products region
    // is rebuilt and re-enhanced (a fresh <select>, if any, needs
    // custom-select-module to pick it up).
    function refreshProductSection(request) {
        const node = elementFor(request.uid);
        const slot = node && node.querySelector('.quote-products');
        if (!slot) return;

        slot.innerHTML = productSectionHTML(request);
        enhance(slot);
        refreshSummary(request);
    }

    // A sub-category change or a product pick: only the plain-button grid
    // changes, never the select sitting above it — see productSectionHTML's
    // comment for why that split is required, not stylistic. No enhance()
    // call here, same reasoning the old refreshProducts had: nothing in this
    // slot is a <select>.
    function refreshProductGrid(request) {
        const node = elementFor(request.uid);
        const slot = node && node.querySelector('.quote-grid-slot');
        if (!slot) return;

        slot.innerHTML = productPickerHTML(request);
        refreshSummary(request);
    }

    // Numbering is positional, so removing #1 renames the rest rather than
    // leaving a gap the customer has to reconcile with the reference shown.
    function renumber() {
        const nodes = [...overlay.querySelectorAll('.quote-request')];
        const single = nodes.length <= 1;

        nodes.forEach((node, position) => {
            const title = 'Product Request #' + (position + 1);

            const titleNode = node.querySelector('.quote-request-title');
            if (titleNode) titleNode.textContent = title;

            const remove = node.querySelector('.quote-remove');
            if (remove) {
                remove.setAttribute('aria-label', 'Remove ' + title);
                // One request is the minimum the form can be submitted with, so
                // its remove button is hidden rather than shown doing nothing.
                // `flex` comes off with it: leaving two display utilities on one
                // element makes the result depend on Tailwind's rule order.
                remove.classList.toggle('hidden', single);
                remove.classList.toggle('flex', !single);
            }
        });
    }

    // Timers keyed by element, so a request folded and reopened before the first
    // animation finished does not get its cleanup run underneath the second one.
    const foldTimers = new WeakMap();

    function clearFold(body) {
        const timer = foldTimers.get(body);
        if (timer) {
            window.clearTimeout(timer);
            foldTimers.delete(body);
        }
    }

    function settle(body) {
        body.style.maxHeight = '';
        body.style.opacity = '';
        body.style.overflow = '';
    }

    // `animate` is opt-in. The initial render and the validation pass both want
    // the final geometry immediately — validation measures the element to scroll
    // it into view, and a field halfway through a 300ms fold measures wrong.
    function setCollapsed(node, collapsed, animate) {
        const toggle = node.querySelector('.quote-toggle');
        const body = node.querySelector('.quote-body');
        if (!toggle || !body) return;

        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        clearFold(body);

        if (!animate || prefersReducedMotion()) {
            settle(body);
            body.classList.toggle('hidden', collapsed);
            return;
        }

        // Already where it was asked to be, with no animation in flight.
        if (body.classList.contains('hidden') === collapsed) {
            settle(body);
            return;
        }

        body.classList.remove('hidden');
        body.style.overflow = 'hidden';

        // scrollHeight reports the content height whatever max-height clips it
        // to, so it is a valid target in both directions.
        const full = body.scrollHeight + 'px';

        body.style.maxHeight = collapsed ? full : '0px';
        body.style.opacity = collapsed ? '1' : '0';

        void body.offsetHeight;   // commit the start frame, or there is no transition

        body.style.maxHeight = collapsed ? '0px' : full;
        body.style.opacity = collapsed ? '0' : '1';

        foldTimers.set(body, window.setTimeout(() => {
            foldTimers.delete(body);
            // display:none is the resting collapsed state, not a clipped box:
            // it is what keeps a folded request's fields out of the tab order
            // and out of the focus trap's first/last reckoning.
            if (collapsed) body.classList.add('hidden');
            settle(body);
        }, FOLD_MS));
    }

    // Progressive disclosure: only the request being worked on is open. Adding a
    // fifth one should not mean scrolling past four completed ones to reach it.
    function collapseAllExcept(uid, animate) {
        overlay.querySelectorAll('.quote-request').forEach(node => {
            setCollapsed(node, node.dataset.uid !== uid, animate);
        });
    }

    function appendRequest(request, focusIt) {
        const list = document.getElementById('quote-requests');
        if (!list) return;

        list.insertAdjacentHTML('beforeend', requestHTML(request, state.requests.length));

        const node = elementFor(request.uid);
        if (!node) return;

        enhance(node);
        renumber();

        if (focusIt) {
            collapseAllExcept(request.uid, true);

            // `select.quote-category`, not `.quote-category`: custom-select-module
            // mirrors the select's classes onto the trigger it draws, and the
            // trigger is inserted ahead of the select — so the bare class selector
            // hands back a <button> that has no .value and no .options.
            const select = node.querySelector('select.quote-category');
            const trigger = node.querySelector('.srk-select__trigger');

            node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
            (trigger || select || node).focus({ preventScroll: true });
        }
    }

    // ------------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------------
    // Deliberately not `type="email"`'s own check: the form is `novalidate` so
    // that errors are shown inline in the site's own voice rather than in the
    // browser's bubble, which means the format check has to live here.
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const REQUIRED_TEXT_FIELDS = [
        { id: 'quote-business-name', message: 'Enter your business name.' },
        { id: 'quote-contact-name', message: 'Enter a contact person.' },
        { id: 'quote-email', message: 'Enter an email address.' },
        { id: 'quote-business-address', message: 'Enter your business address.' }
    ];

    function validate() {
        clearAllErrors();

        let firstInvalid = null;
        const fail = (field, message) => {
            fieldError(field, message);
            if (!firstInvalid) firstInvalid = field;
        };

        REQUIRED_TEXT_FIELDS.forEach(entry => {
            const field = document.getElementById(entry.id);
            if (field && !field.value.trim()) fail(field, entry.message);
        });

        const email = document.getElementById('quote-email');
        if (email && email.value.trim() && !EMAIL_PATTERN.test(email.value.trim())) {
            fail(email, 'Enter a valid email address.');
        }

        state.requests.forEach(request => {
            const select = document.getElementById(request.uid + '-category');
            const quantity = document.getElementById(request.uid + '-quantity');

            if (!request.category) {
                if (select) fail(select, 'Choose a category.');
                return;
            }

            if (!request.product) {
                const node = elementFor(request.uid);
                if (node) setCollapsed(node, false, false);

                // Falls back to the category select if the product grid is not
                // there to carry the message — a category with nothing published
                // in it renders a note instead of a grid — so an unreportable
                // failure can never let an incomplete request through as valid.
                const productGrid = document.getElementById(request.uid + '-product');
                if (productGrid) fail(productGrid, 'Choose a product.');
                else if (select) fail(select, 'Choose a category that has products in it.');
            }

            if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 99) {
                if (quantity) fail(quantity, 'Enter a quantity from 1 to 99.');
            }
        });

        if (firstInvalid) {
            // A collapsed request hides its own invalid field, so open it before
            // trying to reach it.
            const node = firstInvalid.closest ? firstInvalid.closest('.quote-request') : null;
            if (node) setCollapsed(node, false, false);

            const wrapper = firstInvalid.closest ? firstInvalid.closest('.srk-select') : null;
            const target = (wrapper && wrapper.querySelector('.srk-select__trigger')) || firstInvalid;

            target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
            target.focus({ preventScroll: true });
        }

        return !firstInvalid;
    }

    // ------------------------------------------------------------------
    // SUBMISSION
    // ------------------------------------------------------------------
    // One item per Product Request, in the order the customer built them. The
    // server assigns `position` itself rather than trusting this order, so the
    // array order is the only thing that has to be right here.
    //
    // Both the id and the name of each category and product go up. The id is the
    // join back to the catalogue; the name and price are a snapshot, so a quote
    // still reads as submitted after the product is renamed, repriced or removed.
    // `UNCATEGORISED` is the group for products whose category was deleted or
    // deactivated — there is no id to send, only the label the customer saw.
    // Sourced from the picked product's own category fields — already on
    // every row from /api/products/public — rather than the root group's.
    // Now that a category-with-children exposes its own children, "Machine
    // Spare Parts" on every item regardless of which child was actually
    // picked would be a step backwards from what the picker now shows; the
    // product's own category is what the customer actually chose down to.
    // Falls back to the group when a product carries no category of its own
    // (the UNCATEGORISED case: its category was deleted or deactivated,
    // exactly what group.label already reads as "Other Products" for).
    function composeItems() {
        return state.requests.map(request => {
            const group = groupFor(request.category);
            const product = productById(request.product);

            return {
                category_id: product && product.category_id !== undefined && product.category_id !== null
                    ? product.category_id
                    : null,
                category_name: (product && product.category_name)
                    || (group ? group.label : UNCATEGORISED_LABEL),
                product_id: product ? product.id : null,
                product_name: product ? String(product.name || '') : '',
                product_price: product && product.price !== undefined ? product.price : null,
                quantity: request.quantity
            };
        });
    }

    function readValues() {
        const value = (id) => {
            const field = document.getElementById(id);
            return field ? field.value.trim() : '';
        };

        return {
            business: value('quote-business-name'),
            contact: value('quote-contact-name'),
            email: value('quote-email'),
            phone: value('quote-phone'),
            address: value('quote-business-address'),
            notes: value('quote-notes')
        };
    }

    function showFormError(message) {
        const banner = document.getElementById('quote-form-error');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.remove('hidden');
        banner.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    }

    async function submit(event) {
        event.preventDefault();
        if (state.submitting) return;

        if (!validate()) return;

        const button = document.getElementById('quote-submit');
        const values = readValues();

        state.submitting = true;
        if (button) {
            button.disabled = true;
            button.textContent = 'Submitting…';
        }

        try {
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    business_name: values.business,
                    contact_name: values.contact,
                    email: values.email,
                    phone: values.phone,
                    business_address: values.address,
                    notes: values.notes,
                    items: composeItems()
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Failed to submit the quote request.');

            // The server composes the reference from the row's own created_at, so
            // it and the back office can never disagree about the year. referenceFor
            // is the fallback for a response that somehow carries only the id.
            showSuccess(result.reference || referenceFor(result.id));
        } catch (error) {
            console.error('Request a Quote: submission failed.', error);
            showFormError(error.message || 'Something went wrong. Please try again, or reach us on the contact page.');

            state.submitting = false;
            if (button) {
                button.disabled = false;
                button.textContent = 'Submit Quote Request';
            }
        }
    }

    // ------------------------------------------------------------------
    // VIEWS
    // ------------------------------------------------------------------
    // The scrolling region under the header. openOverlay names it after the
    // overlay's own id, and hands it back on the handle.
    function body() {
        return handle ? handle.body : null;
    }

    function handlePrintQuote(button) {
        if (!button || button.disabled) return;
        let style = document.getElementById('quote-print-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'quote-print-styles';
            style.textContent = '@media print{body>*:not(#quote-overlay){display:none!important}#quote-overlay{position:static!important;inset:auto!important;background:#fff!important}#quote-overlay>div{box-shadow:none!important;max-width:none!important;width:100%!important;height:auto!important}#quote-print,#quote-done{display:none!important}}';
            document.head.appendChild(style);
        }
        window.print();
    }

    function showSuccess(reference) {
        const scroll = body();
        if (!scroll) return;

        scroll.innerHTML = successHTML(reference);
        scroll.scrollTop = 0;

        const done = document.getElementById('quote-done');
        if (done) {
            done.addEventListener('click', close);
            done.focus({ preventScroll: true });
        }

        const print = document.getElementById('quote-print');
        if (print) print.addEventListener('click', () => handlePrintQuote(print));
    }

    function showForm() {
        const scroll = body();
        if (!scroll) return;

        scroll.innerHTML = formHTML();

        state.requests.forEach(request => appendRequest(request, false));
        renumber();

        enhance(scroll);
        wireForm();

        const first = document.getElementById('quote-business-name');
        if (first) first.focus({ preventScroll: true });
    }

    async function showCatalogue() {
        const scroll = body();
        if (!scroll) return;

        scroll.innerHTML = loadingHTML();

        let products;
        let categories;
        try {
            [products, categories] = await Promise.all([section.loadProducts(), section.loadCategories()]);
        } catch (error) {
            console.error('Request a Quote: could not load the catalogue.', error);
            scroll.innerHTML = catalogueErrorHTML();

            const retry = document.getElementById('quote-retry');
            if (retry) retry.addEventListener('click', showCatalogue);
            return;
        }

        // The overlay may have been closed while the fetch was in flight.
        if (!overlay || !overlay.isConnected) return;

        state.products = products;
        state.index = indexCategories(categories);
        state.groups = buildGroups(products, state.index);

        if (!state.groups.length) {
            scroll.innerHTML = emptyCatalogueHTML();
            return;
        }

        if (!state.requests.length && state.initialItems.length) {
            state.requests = state.initialItems.map(requestForProduct).filter(Boolean);
        }
        if (!state.requests.length) state.requests.push(blankRequest());

        showForm();
    }

    // ------------------------------------------------------------------
    // WIRING
    // ------------------------------------------------------------------
    function wireForm() {
        const form = document.getElementById('quote-form');
        if (!form) return;

        form.addEventListener('submit', submit);

        // An error that stays on screen after it has been fixed reads as the form
        // being stuck, so each field clears its own the moment it is touched.
        form.addEventListener('input', (event) => {
            const field = event.target.closest('input, textarea');
            if (field && field.id && field.classList.contains('border-red-500')) clearFieldError(field);

            if (field && field.matches('.quote-quantity')) {
                const request = requestFor(field);
                if (request) {
                    request.quantity = Number.parseInt(field.value, 10);
                    refreshSummary(request);
                }
            }
        });

        // Matched on the element itself, and by tag: custom-select-module copies
        // a select's classes onto the trigger it draws, so a bare `.quote-category`
        // selector can resolve to a <button> with no value.
        form.addEventListener('change', (event) => {
            const target = event.target;
            if (!target || !target.matches) return;

            if (target.matches('select.quote-category')) onCategoryChange(target);
            else if (target.matches('select.quote-subcategory')) onSubcategoryChange(target);
        });

        form.addEventListener('click', (event) => {
            const add = event.target.closest('#quote-add');
            if (add) {
                onAdd();
                return;
            }

            const toggle = event.target.closest('.quote-toggle');
            if (toggle) {
                onToggle(toggle);
                return;
            }

            const remove = event.target.closest('.quote-remove');
            if (remove) {
                onRemove(remove);
                return;
            }

            const card = event.target.closest('.quote-product-card');
            if (card) onProductCardSelect(card);
        });
    }

    function requestFor(node) {
        const article = node.closest('.quote-request');
        if (!article) return null;

        return state.requests.find(request => request.uid === article.dataset.uid) || null;
    }

    function onCategoryChange(select) {
        const request = requestFor(select);
        if (!request) return;

        request.category = select.value;
        // A product belongs to the category it was chosen from. Carrying it
        // across a category change would submit something the customer can no
        // longer see in the field. A stale child id is the same problem one
        // level up: the new category's children are not the old one's.
        request.product = '';
        request.subcategory = DIRECT_ONLY;

        if (select.value) clearFieldError(select);
        refreshProductSection(request);
    }

    function onSubcategoryChange(select) {
        const request = requestFor(select);
        if (!request) return;

        request.subcategory = select.value;
        // Same rule as a category change: a product belongs to the
        // sub-category it was chosen from.
        request.product = '';

        refreshProductGrid(request);
    }

    function onProductCardSelect(card) {
        const request = requestFor(card);
        if (!request) return;

        const id = card.dataset.productId || '';
        request.product = id;

        // Repaint the whole grid, not just the clicked card: the checkmark badge
        // has to come off whichever card carried it before, and only the picker
        // itself knows which one that was. Never the section — a product pick
        // cannot change which sub-category is selected.
        refreshProductGrid(request);

        if (!id) return;

        const grid = document.getElementById(request.uid + '-product');
        if (grid) clearFieldError(grid);

        // Picking the product is the last thing a request needs, so it folds
        // itself away — after a short delay, so the checkmark landing on the
        // card and the fold read as one movement rather than a collision, the
        // same beat the dropdown version of this used to keep with its panel.
        const node = elementFor(request.uid);
        if (!node) return;

        window.setTimeout(() => {
            // The visitor may have picked a different card, cleared the field or
            // removed the request entirely while the delay was running.
            if (!overlay || !node.isConnected || !request.product) return;

            // The clicked card is about to be inside a display:none panel, so
            // focus is moved up to the request's own header button first — it
            // stays on screen when folded, so the focus ring lands where the
            // visitor's attention already is instead of being dropped to <body>.
            const active = document.activeElement;
            if (active && node.contains(active)) {
                const toggle = node.querySelector('.quote-toggle');
                if (toggle) toggle.focus({ preventScroll: true });
            }

            setCollapsed(node, true, true);
        }, SELECT_FOLD_DELAY_MS);
    }

    function onToggle(toggle) {
        const node = toggle.closest('.quote-request');
        if (!node) return;

        setCollapsed(node, toggle.getAttribute('aria-expanded') === 'true');
    }

    function onAdd() {
        const request = blankRequest();
        state.requests.push(request);
        appendRequest(request, true);
    }

    function onRemove(button) {
        const request = requestFor(button);
        if (!request || state.requests.length <= 1) return;

        const node = elementFor(request.uid);
        state.requests = state.requests.filter(entry => entry.uid !== request.uid);

        if (node) node.remove();
        renumber();
    }

    // ------------------------------------------------------------------
    // OVERLAY
    // ------------------------------------------------------------------
    // The lifecycle — the fade, the body-scroll lock, the focus trap, Escape,
    // and handing focus back to whatever opened it — is
    // store-overlay-shared-module.js's `openOverlay`. What stays here is what
    // is specific to a quote: the state object it opens with, the catalogue
    // fetch it kicks off, and handing the sidebar's gold state back on the way
    // out.
    function open(initial) {
        if (handle) return;

        ensureStyles(STYLE_ID, CSS);

        // Three ways a selection arrives, in order of directness:
        //
        //   1. handed straight to open() — the cart drawer and the product
        //      details overlay, both of which are on this page already;
        //   2. window.srkPendingQuoteItems — the same two, one beat earlier,
        //      set before close() clears their state;
        //   3. sessionStorage — checkout.html's "These need a quote", which
        //      reaches this form by a navigation and so cannot use a global.
        //
        // The stored copy is CONSUMED whichever branch wins, so a basket
        // carried across a navigation is offered once and cannot resurface
        // over a later, deliberate open() of an empty form.
        const stored = (window.storeOverlay && window.storeOverlay.pendingQuote)
            ? window.storeOverlay.pendingQuote.take()
            : [];

        const initialItems = Array.isArray(initial && initial.items) && initial.items.length
            ? initial.items
            : (Array.isArray(window.srkPendingQuoteItems) && window.srkPendingQuoteItems.length
                ? window.srkPendingQuoteItems
                : stored);
        window.srkPendingQuoteItems = [];
        state = {
            products: [], groups: [], index: null, requests: [], submitting: false,
            initialItems: initialItems.slice(0, 12)
        };

        handle = chrome.openOverlay({
            id: 'quote-overlay',
            titleId: 'quote-title',
            closeId: 'quote-close',
            header: headerHTML(),
            onClose: () => {
                handle = null;
                overlay = null;
                state = null;
                restoreNav();
            }
        });

        overlay = handle.node;

        showCatalogue();
    }

    function close() {
        if (handle) handle.close();
    }

    // ------------------------------------------------------------------
    // TRIGGER
    // ------------------------------------------------------------------
    // store.html's inline nav script moves the gold active state onto whichever
    // .nav-btn was clicked. That is right for the six buttons that swap
    // #dynamic-view and wrong for this one: closing the overlay reveals the
    // section that was there all along, under a sidebar claiming the visitor is
    // still on "Request a Quote". So the previously active button is noted on the
    // way in and handed its state back on the way out.
    const ACTIVE_CLASSES = ['text-[#d4af37]', 'bg-[#d4af37]/10'];
    const IDLE_CLASSES = ['hover:text-[#d4af37]', 'hover:bg-[#d4af37]/5'];

    let previousNav = null;

    function markActive(button) {
        if (!button) return;
        button.classList.remove(...IDLE_CLASSES);
        button.classList.add(...ACTIVE_CLASSES);
    }

    function markIdle(button) {
        if (!button) return;
        button.classList.remove(...ACTIVE_CLASSES);
        button.classList.add(...IDLE_CLASSES);
    }

    function restoreNav() {
        const trigger = document.querySelector('button[data-policy="quote"]');
        if (!previousNav || previousNav === trigger) return;

        markIdle(trigger);
        markActive(previousNav);
        previousNav = null;
    }

    function attach() {
        if (!document.querySelector('button[data-policy="quote"]')) return;

        // Capture at the document, not a listener on the button: at the target
        // itself capture and bubble listeners run in registration order, so a
        // listener on the button could not reliably read the active state before
        // the inline script overwrote it.
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest && event.target.closest('button[data-policy="quote"]');
            if (!trigger) return;

            previousNav = [...document.querySelectorAll('.nav-btn')]
                .find(button => button.classList.contains('text-[#d4af37]')) || null;

            event.preventDefault();
            open();
        }, true);

        // The header's "Get a Quote" link lives on nine other pages, where there
        // is no sidebar button to click — `#quote` is how that link asks for the
        // overlay once the store page exists. The hash is dropped as it opens,
        // for the same reason the button is in this page's `data-skip` list: a
        // refresh should hand back the page the visitor was on, not a fresh
        // empty form on top of it.
        if (window.location.hash === '#quote') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
            open();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();

    // ------------------------------------------------------------------
    // "Request a price" on an unpriced product card
    // ------------------------------------------------------------------
    // product-section-shared-module.js's card() draws this button instead of
    // Buy Now / add-to-cart whenever a product carries no numeric price, which
    // is most of this catalogue. It opens the quote form already holding that
    // product, so the customer never re-picks the thing they just clicked.
    //
    // One delegated listener on the document, for the reason cart-module.js
    // gives for its own: the four product sections replace the whole of
    // #dynamic-view on every nav click, and the search overlay renders the
    // same cards again, so nothing may be bound per button.
    //
    // Capture, and stopPropagation, because product-details-module.js listens
    // on the document too and would otherwise open the details overlay
    // *underneath* the quote form — the same collision its own guard against
    // .cart-icon-btn / .buy-now-btn exists to prevent. That guard has been
    // extended to this class as well, since stopPropagation does not stop
    // listeners already attached to the same node.
    document.addEventListener('click', event => {
        const button = event.target.closest && event.target.closest('.request-price-btn');
        if (!button) return;

        const article = button.closest('article[data-product-id]');
        const productId = article ? article.getAttribute('data-product-id') : null;

        event.preventDefault();
        event.stopPropagation();

        // No id is not a reason to do nothing — the form is still the right
        // destination, it just opens empty rather than pre-filled.
        open(productId ? { items: [{ product_id: productId, quantity: 1 }] } : undefined);
    }, true);

    window.requestQuote = { open, close };
})();
