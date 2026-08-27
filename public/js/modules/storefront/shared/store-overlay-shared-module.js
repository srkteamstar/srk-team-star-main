/**
 * store-overlay-shared-module.js
 *
 * The parts every full-screen surface on the store page needs and none of them
 * should own: the design tokens, the icon set, the overlay and drawer
 * lifecycles, the focus trap, and the field markup an inline-validated form is
 * built out of.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * request-quote-module.js worked all of this out first, and its own DESIGN
 * TOKENS comment says the point of collecting them was to have "one obvious
 * place to be repeated rather than a near-miss copy to be found later". Three
 * more surfaces — the cart drawer, the account overlay, the search overlay —
 * would have made four copies of that one place, which is the failure the
 * comment was written to prevent.
 *
 * So this is the same move product-section-shared-module.js already made when
 * four sections turned out to be rendering four hand-maintained copies of one
 * card. The quote module now reads its tokens from here; nothing about it
 * changed except where the constants live.
 *
 * WHAT BELONGS HERE
 * -----------------
 * Only what more than one surface needs, and only the parts that are the same
 * for all of them. The quote form's fold animation, the cart's quantity
 * stepper and the search box's debounce each stay in their own file: they are
 * that feature's behaviour, not the page's chrome.
 *
 * TWO OVERLAY SHAPES, DELIBERATELY
 * --------------------------------
 * `openOverlay` is a full-bleed opaque takeover — for a task that deserves the
 * whole screen and would be a nuisance to lose to a stray click (writing a
 * quote, signing in, reading search results). `openDrawer` is a right-hand
 * panel over a dimmed page — for something the visitor is holding while they
 * keep shopping (the cart). Both share one lifecycle, one focus trap and one
 * Escape rule, so they behave identically even though they look different.
 *
 * LOAD ORDER
 * ----------
 * After product-section-shared-module.js, whose escapeHtml this reuses rather
 * than carrying a fourth copy of. Before every surface that consumes it:
 * cart-module.js, profile-icon-loader.js, store-search-module.js and
 * request-quote-module.js.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.storeOverlay) return;

    const section = window.productSection;
    if (!section) {
        console.error('store-overlay-shared-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml } = section;

    // ------------------------------------------------------------------
    // DESIGN TOKENS
    // ------------------------------------------------------------------
    // Lifted verbatim from the markup they already appear in, so a change to
    // the site's field or button styling has one obvious place to be repeated
    // rather than a near-miss copy to be found later.
    const FIELD_CLASSES = 'w-full bg-[#f1f5f9] border border-[#12170f]/25 rounded-md px-4 py-3 text-[#1f271b] placeholder-[#1f271b]/50 focus:outline-none focus:ring-2 focus:ring-[#d4af37] focus:border-transparent transition-all';

    const PRIMARY_BUTTON_CLASSES = 'inline-flex items-center justify-center bg-[#d4af37] text-white text-base font-semibold px-8 py-3.5 rounded hover:bg-[#c09f32] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';

    // The quiet counterpart, for the action next to a primary one that must not
    // compete with it — "Clear cart", "Cancel", "Keep shopping". Built from the
    // store's hairline border idiom rather than a greyed-out gold, so it reads
    // as a different kind of action and not as a disabled one.
    const SECONDARY_BUTTON_CLASSES = 'srk-secondary-btn inline-flex items-center justify-center bg-white text-[#12170f] text-sm font-bold px-6 py-3 rounded border border-[#12170f]/15 hover:bg-[#12170f] hover:text-white hover:border-[#12170f] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] disabled:opacity-60 disabled:cursor-not-allowed';

    // The round hairline icon button the store's search row already uses for
    // profile and cart.
    const ICON_BUTTON_CLASSES = 'w-11 h-11 shrink-0 bg-white border border-[#12170f]/10 rounded-full flex items-center justify-center hover:border-[#d4af37] hover:bg-gray-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]';

    const EYEBROW_CLASSES = 'text-[10px] font-bold uppercase tracking-wider text-[#d4af37]';

    const SHELL = 'w-full max-w-3xl mx-auto px-6 md:px-10 lg:px-12';

    const TOKENS = {
        FIELD_CLASSES,
        PRIMARY_BUTTON_CLASSES,
        SECONDARY_BUTTON_CLASSES,
        ICON_BUTTON_CLASSES,
        EYEBROW_CLASSES,
        SHELL
    };

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    // `ensureStyles` is the shared injector; the base sheet below is this
    // module's own contribution.
    //
    // `.store-icon` is the fix for the trap store.html documents for its
    // add-to-cart glyph and CLAUDE.md documents twice more: every page opens
    // its inline <style> with a universal rule setting `color` on *every*
    // element, the <svg> included, and a direct match beats an inherited one.
    // So `hover:text-[#d4af37]` on a button can never reach a glyph drawn with
    // stroke="currentColor". These rules paint the glyph itself.
    //
    // Note this is NOT interchangeable with store.html's `.cart-icon-btn`,
    // which strokes the glyph *white* on hover because that button fills in
    // dark. A `.store-icon` button stays white on hover, so its glyph goes
    // gold. Same trap, opposite answer — which is why both rules exist.
    const BASE_STYLE_ID = 'store-overlay-styles';

    const BASE_CSS = [
        '.store-icon svg{stroke:#12170f;transition:stroke 200ms ease;}',
        '.store-icon:hover svg,.store-icon:focus-visible svg{stroke:#d4af37;}',
        '.store-icon--danger:hover svg,.store-icon--danger:focus-visible svg{stroke:#b91c1c;}',

        // The secondary button fills near-black on hover, so anything drawn
        // with stroke="currentColor" inside it would vanish into the fill —
        // every page's universal `* { color: ... }` rule matches the <svg>
        // directly, and a direct match beats the colour the button hands
        // down. Only quote's Print / Download PDF has an icon today; this is
        // here so the next one does not have to rediscover it.
        '.srk-secondary-btn svg{stroke:#12170f;transition:stroke 200ms ease;}',
        '.srk-secondary-btn:hover svg{stroke:#ffffff;}',
        // A disabled button is not a target, so it must not answer a hover.
        '.srk-secondary-btn:disabled:hover{background:#ffffff;color:#12170f;border-color:rgba(18,23,15,.15);}',
        '.srk-secondary-btn:disabled:hover svg{stroke:#12170f;}',

        /* `.srk-scroll` is NOT defined here. Every scrolling region inside an
           overlaid surface carries it — the two below, the quote picker's
           product grid, a resized textarea — and it is defined by
           scroll-lock-module.js, which is loaded on all 17 documents and owns
           both halves of this fix: holding the page still, and stopping a drag
           past the end of a scroller ever being offered to it. The store's
           surfaces are not the only ones that need the second half, which is
           why the rule is not the store's to keep. */

        '.store-chevron{transition:transform 200ms ease;}',
        '[aria-expanded="true"] > .store-chevron{transform:rotate(180deg);}',

        /* The trigger custom-select-module draws inherits the select's classes,
           including w-full. */
        '.srk-field .srk-select__trigger{width:100%;}',

        '@media (prefers-reduced-motion:reduce){',
        '.store-icon svg,.store-chevron{transition:none;}',
        '.srk-overlay,.srk-drawer-panel,.srk-drawer-backdrop{transition:none!important;}',
        '}'
    ].join('');

    function ensureStyles(id, css) {
        if (document.getElementById(id)) return;

        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ------------------------------------------------------------------
    // ICONS
    // ------------------------------------------------------------------
    const icon = (path, extraClasses) =>
        '<svg class="' + (extraClasses || 'w-5 h-5') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + path + '"></path></svg>';

    const CLOSE_ICON = icon('M6 18L18 6M6 6l12 12');
    const CHEVRON_ICON = icon('M19 9l-7 7-7-7', 'store-chevron w-4 h-4 text-[#12170f]/40');
    const TRASH_ICON = icon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', 'w-4 h-4');
    const PLUS_ICON = icon('M12 4v16m8-8H4', 'w-4 h-4');
    const MINUS_ICON = icon('M20 12H4', 'w-4 h-4');
    const CHECK_ICON = icon('M5 13l4 4L19 7', 'w-7 h-7');

    // The bag glyph the product cards already draw, so the cart's own chrome
    // and the button that fills it are visibly the same object.
    const BAG_ICON = icon('M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9zm7 4v4m-2-2h4');
    const USER_ICON = icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z');
    const SEARCH_ICON = icon('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z');
    const PACKAGE_ICON = icon('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4');

    // ------------------------------------------------------------------
    // MARKUP — chrome
    // ------------------------------------------------------------------
    // Every full-bleed surface opens the same way: a title the dialog is
    // labelled by, an optional sentence saying what the surface is for, and a
    // round close button on the right. `shrink-0` keeps it off the scroll.
    function headerHTML(options) {
        return [
            '<header class="shrink-0 bg-white border-b border-[#12170f]/10">',
            '    <div class="' + SHELL + ' py-5 md:py-6 flex items-start justify-between gap-6">',
            '        <div class="min-w-0">',
            '            <h2 id="' + options.titleId + '" class="text-2xl md:text-3xl font-bold tracking-tight text-[#12170f]">' + escapeHtml(options.title) + '</h2>',
            options.subtitle
                ? '            <p class="text-sm text-[#1f271b]/60 mt-1.5 max-w-lg">' + escapeHtml(options.subtitle) + '</p>'
                : '',
            '        </div>',
            '        <button type="button" id="' + options.closeId + '" class="store-icon ' + ICON_BUTTON_CLASSES + '" aria-label="' + escapeHtml(options.closeLabel || 'Close') + '">',
            '            ' + CLOSE_ICON,
            '        </button>',
            '    </div>',
            '</header>'
        ].filter(line => line !== '').join('\n');
    }

    // The drawer is narrower than the overlay, so its header drops the shell
    // and the subtitle and keeps the close button inline with the title.
    function drawerHeaderHTML(options) {
        return [
            '<div class="shrink-0 px-6 py-5 border-b border-[#12170f]/10 flex items-center justify-between gap-4 bg-white">',
            '    <h2 id="' + options.titleId + '" class="text-xl font-bold tracking-tight text-[#12170f] truncate">' + escapeHtml(options.title) + '</h2>',
            '    <button type="button" id="' + options.closeId + '" class="store-icon w-9 h-9 shrink-0 rounded-full flex items-center justify-center border border-transparent hover:border-[#12170f]/10 hover:bg-gray-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]" aria-label="' + escapeHtml(options.closeLabel || 'Close') + '">',
            '        ' + CLOSE_ICON,
            '    </button>',
            '</div>'
        ].join('\n');
    }

    function sectionHeading(number, title, hint) {
        return [
            '<div class="flex items-baseline gap-3 pb-4 mb-6 border-b border-[#12170f]/10">',
            '    <span class="' + EYEBROW_CLASSES + '">' + escapeHtml(number) + '</span>',
            '    <h3 class="text-lg font-bold tracking-tight text-[#12170f]">' + escapeHtml(title) + '</h3>',
            hint ? '    <span class="text-xs text-[#1f271b]/40 ml-auto">' + escapeHtml(hint) + '</span>' : '',
            '</div>'
        ].filter(line => line !== '').join('\n');
    }

    function centredMessageHTML(inner) {
        return '<div class="' + SHELL + ' py-20 text-center">' + inner + '</div>';
    }

    // ------------------------------------------------------------------
    // MARKUP — fields
    // ------------------------------------------------------------------
    function labelHTML(id, text, required) {
        return '<label for="' + id + '" class="block text-sm font-semibold text-[#1f271b] mb-2">' +
            escapeHtml(text) +
            (required ? ' <span class="text-[#d4af37]" aria-hidden="true">*</span>' : '') +
            '</label>';
    }

    // Every field owns its error line from the start, so showing one never
    // moves the fields below it — the message occupies reserved space that is
    // simply empty until it is needed.
    function errorHTML(id) {
        return '<p id="' + id + '-error" class="srk-field-error hidden text-sm text-red-600 mt-1.5"></p>';
    }

    // `readonly` is a real, author-set readonly here — not the resting state
    // disable-input-suggestions-module.js arms and releases around a
    // keystroke. That module leaves an author-marked readonly field alone
    // precisely so the two cannot fight, which is what makes this safe.
    // `inputmode` and `maxlength` are optional and emit nothing when absent,
    // so every existing caller renders byte-identically. They exist for the
    // account overlay's 6-digit authenticator field, where a phone that
    // offers a full qwerty keyboard for a number-only box is a small, daily
    // annoyance with a one-attribute fix.
    function textFieldHTML(options) {
        const id = options.id;
        const locked = options.readonly === true;
        const autocomplete = options.autocomplete || 'srk-no-autofill';
        const passwordManager = options.autocomplete ? ' data-srk-password-manager="allow"' : '';

        return [
            '<div>',
            '    ' + labelHTML(id, options.label, options.required),
            '    <input autocomplete="' + escapeHtml(autocomplete) + '"' + passwordManager + ' spellcheck="false" id="' + id + '" name="' + id + '"',
            '           type="' + (options.type || 'text') + '" placeholder="' + escapeHtml(options.placeholder || '') + '"',
            '           value="' + escapeHtml(options.value || '') + '"',
            (options.inputmode ? '           inputmode="' + escapeHtml(options.inputmode) + '"' : ''),
            (options.maxlength ? '           maxlength="' + Number(options.maxlength) + '"' : ''),
            (locked ? '           readonly tabindex="-1"' : ''),
            '           class="' + FIELD_CLASSES + (locked ? ' !bg-[#e6ebf2] text-[#1f271b]/55 cursor-not-allowed' : '') + '" />',
            '    ' + errorHTML(id),
            '</div>'
        ].filter(line => line !== '').join('\n');
    }

    function textAreaHTML(options) {
        const id = options.id;

        return [
            '<div>',
            '    ' + labelHTML(id, options.label, options.required),
            '    <textarea autocomplete="srk-no-autofill" spellcheck="false" id="' + id + '" name="' + id + '"',
            '              rows="' + (options.rows || 3) + '" placeholder="' + escapeHtml(options.placeholder || '') + '"',
            '              class="' + FIELD_CLASSES + ' srk-scroll resize-y min-h-[96px] max-h-[220px] overflow-y-auto">' + escapeHtml(options.value || '') + '</textarea>',
            '    ' + errorHTML(id),
            '</div>'
        ].join('\n');
    }

    // The failure banner is the shape enquiries.js already uses for a failed
    // fetch, so an error on the storefront and an error in the back office look
    // like the same product reporting the same problem.
    function bannerHTML(id) {
        return '<div id="' + id + '" class="hidden mb-5 p-4 bg-red-50 text-red-700 rounded-sm border border-red-200 text-sm font-semibold"></div>';
    }

    // ------------------------------------------------------------------
    // FIELD ERRORS
    // ------------------------------------------------------------------
    function syncSelectTrigger(field) {
        if (field.tagName !== 'SELECT') return;

        const wrapper = field.closest('.srk-select');
        const trigger = wrapper && wrapper.querySelector('.srk-select__trigger');
        if (!trigger) return;

        trigger.classList.toggle('border-red-500', field.classList.contains('border-red-500'));
        trigger.classList.toggle('border-[#12170f]/25', !field.classList.contains('border-red-500'));
    }

    function fieldError(field, message) {
        const holder = document.getElementById(field.id + '-error');
        if (holder) {
            holder.textContent = message;
            holder.classList.remove('hidden');
        }

        field.classList.remove('border-[#12170f]/25');
        field.classList.add('border-red-500');
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', field.id + '-error');

        // custom-select-module mirrors the select's classes onto its trigger,
        // but only when they change through its own observer — nudging the
        // value is not involved here, so the trigger is repainted directly.
        syncSelectTrigger(field);
    }

    function clearFieldError(field) {
        const holder = document.getElementById(field.id + '-error');
        if (holder) {
            holder.textContent = '';
            holder.classList.add('hidden');
        }

        field.classList.remove('border-red-500');
        field.classList.add('border-[#12170f]/25');
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');

        syncSelectTrigger(field);
    }

    // Routed through clearFieldError rather than stripping the class in bulk:
    // a select's error also lives on the trigger custom-select-module drew for
    // it, and only clearFieldError knows to repaint that too.
    function clearErrorsIn(root, bannerId) {
        if (!root) return;

        root.querySelectorAll('.srk-field-error').forEach(node => {
            node.textContent = '';
            node.classList.add('hidden');
        });

        root
            .querySelectorAll('input.border-red-500, textarea.border-red-500, select.border-red-500')
            .forEach(clearFieldError);

        if (bannerId) {
            const banner = document.getElementById(bannerId);
            if (banner) banner.classList.add('hidden');
        }
    }

    // ------------------------------------------------------------------
    // ENHANCEMENT
    // ------------------------------------------------------------------
    // custom-select-module picks injected selects up through a mutation
    // observer a tick later — long enough for the raw native dropdown to flash
    // — and disable-input-suggestions-module the same. Both are called
    // directly so the markup is finished before it is ever painted.
    function enhance(root) {
        if (typeof window.enhanceCustomSelects === 'function') window.enhanceCustomSelects(root);
        if (typeof window.disableInputSuggestions === 'function') window.disableInputSuggestions(root);
    }

    // ------------------------------------------------------------------
    // FOCUS TRAP
    // ------------------------------------------------------------------
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Returns the keydown handler so the caller can remove exactly the one it
    // added. Registered in the capture phase, because a listener further down
    // the tree must not get to swallow Escape first.
    function trapFocus(node, onEscape) {
        function onKeydown(event) {
            if (event.key === 'Escape') {
                // A dropdown panel is the innermost layer; Escape belongs to it
                // first, and custom-select-module closes it on the same key.
                if (node.querySelector('.srk-select__trigger[aria-expanded="true"]')) return;

                event.preventDefault();
                onEscape();
                return;
            }

            if (event.key !== 'Tab') return;

            // An open dropdown owns Tab as well as Escape — its panel is
            // rendered into <body>, outside this overlay, so trapping focus
            // back inside would fight the module that put it there.
            if (node.querySelector('.srk-select__trigger[aria-expanded="true"]')) return;

            // The surface covers the store but the store is still in the
            // document, so without this the next Tab walks out of the dialog
            // into a sidebar the visitor cannot see.
            //
            // Enhanced selects stay in the DOM as hidden tabindex="-1"
            // natives, and a collapsed region's fields are display:none —
            // neither is reachable, so neither may be an end of the cycle.
            const focusable = [...node.querySelectorAll(FOCUSABLE)]
                .filter(el => el.getAttribute('tabindex') !== '-1')
                .filter(el => el.offsetParent !== null || el === document.activeElement);

            if (!focusable.length) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', onKeydown, true);
        return onKeydown;
    }

    // ------------------------------------------------------------------
    // LIFECYCLE
    // ------------------------------------------------------------------
    const FADE_MS = 300;   // matches duration-300 on every surface below

    // HOLDING THE PAGE STILL IS scroll-lock-module.js's JOB, NOT THIS FILE'S.
    //
    // The counting note that used to live here was right and is still true —
    // surfaces nest, and two of them unlocking independently would leave the
    // page scrollable underneath the one still open. It has moved, along with
    // the counter, to a platform module, because the surfaces that nest are no
    // longer all in this file: the mobile navigation panel locks the page too,
    // is on all 17 documents, and had a private counter of its own. Two
    // counters cannot agree about when nothing is open.
    //
    // What the move also bought is a lock that survives a phone.
    // `document.body.style.overflow = 'hidden'` — what this function used to
    // be, in full — is advisory on iOS Safari, so a drag past the end of an
    // overlay's scrolling region scrolled the store away behind it. See that
    // file's header for the two mechanics and the two answers.
    //
    // The fallback is the old line, for a page that somehow loaded without the
    // module: worse on a phone, but never nothing.
    function lockScroll() {
        if (window.srkScrollLock) window.srkScrollLock.lock();
        else document.body.style.overflow = 'hidden';
    }

    function unlockScroll() {
        if (window.srkScrollLock) window.srkScrollLock.unlock();
        else document.body.style.overflow = '';
    }

    /**
     * Full-bleed opaque takeover.
     *
     * options: { id, titleId, header, closeId, footer, onClose }
     * returns: { node, body, footerEl, close }
     *
     * `body` is the scrolling region — set its innerHTML as often as the
     * surface needs; the header and the trap survive.
     *
     * `footerEl` is a `shrink-0` sibling *after* body, drawn only when
     * `options.footer` is truthy — the same shape openDrawer gives the cart,
     * and a genuinely pinned region with its own scroll boundary. A
     * `sticky bottom-0` inside `body` (what the quote form and the account
     * overlay do) stays in the scroll flow instead, which is right for a
     * submit bar the visitor scrolls *to* and wrong for a rail they scroll
     * *past*: sticky overlaps the content sliding under it.
     */
    function openOverlay(options) {
        ensureStyles(BASE_STYLE_ID, BASE_CSS);

        const lastFocused = document.activeElement;

        const node = document.createElement('section');
        node.id = options.id;
        node.className = 'srk-overlay fixed inset-0 z-[100] bg-white flex flex-col opacity-0 transition-opacity duration-300 ease-out selection:bg-[#d4af37] selection:text-white';
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        node.setAttribute('aria-labelledby', options.titleId);
        // Opt-in, unlike openDrawer's, which is always drawn. A surface
        // that does not ask gets byte-identical DOM to what it got before
        // this parameter existed.
        node.innerHTML = (options.header || '') +
            '\n<div id="' + options.id + '-scroll" class="srk-scroll flex-1 overflow-y-auto"></div>' +
            (options.footer
                ? '\n<div id="' + options.id + '-footer" class="shrink-0"></div>'
                : '');

        document.body.appendChild(node);
        lockScroll();

        // Force a reflow so the class swap animates instead of being coalesced
        // into the initial paint.
        void node.offsetWidth;
        node.classList.replace('opacity-0', 'opacity-100');

        let closed = false;

        function close() {
            if (closed) return;
            closed = true;

            document.removeEventListener('keydown', keyHandler, true);
            if (typeof options.onClose === 'function') options.onClose();

            node.classList.replace('opacity-100', 'opacity-0');

            window.setTimeout(() => {
                node.remove();
                unlockScroll();
            }, prefersReducedMotion() ? 0 : FADE_MS);

            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
        }

        const keyHandler = trapFocus(node, close);

        const closeButton = options.closeId ? node.querySelector('#' + options.closeId) : null;
        if (closeButton) closeButton.addEventListener('click', close);

        return {
            node,
            body: node.querySelector('#' + options.id + '-scroll'),
            // null unless the caller asked, so a surface cannot silently
            // write into a slot it never requested.
            footerEl: options.footer ? node.querySelector('#' + options.id + '-footer') : null,
            close
        };
    }

    /**
     * Right-hand panel over a dimmed page.
     *
     * options: { id, titleId, header, closeId, onClose }
     * returns: { node, panel, body, footerEl, close }
     *
     * The footer here is always drawn and the caller fills `footerEl`, unlike
     * openOverlay's, which is opt-in. (This block used to list a `footer`
     * option; nothing has ever read it.)
     */
    function openDrawer(options) {
        ensureStyles(BASE_STYLE_ID, BASE_CSS);

        const lastFocused = document.activeElement;

        const node = document.createElement('section');
        node.id = options.id;
        node.className = 'fixed inset-0 z-[100] selection:bg-[#d4af37] selection:text-white';
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        node.setAttribute('aria-labelledby', options.titleId);

        node.innerHTML = [
            '<div id="' + options.id + '-backdrop" class="srk-drawer-backdrop absolute inset-0 bg-[#000000]/70 opacity-0 transition-opacity duration-300 ease-out"></div>',
            '<aside id="' + options.id + '-panel" class="srk-drawer-panel absolute right-0 top-0 h-full w-full sm:w-[480px] bg-white flex flex-col shadow-[-4px_0_24px_-8px_rgba(0,0,0,0.25)] translate-x-full transition-transform duration-300 ease-out">',
            options.header || '',
            '    <div id="' + options.id + '-scroll" class="srk-scroll flex-1 overflow-y-auto"></div>',
            '    <div id="' + options.id + '-footer" class="shrink-0"></div>',
            '</aside>'
        ].join('\n');

        document.body.appendChild(node);
        lockScroll();

        const backdrop = node.querySelector('#' + options.id + '-backdrop');
        const panel = node.querySelector('#' + options.id + '-panel');

        void node.offsetWidth;
        backdrop.classList.replace('opacity-0', 'opacity-100');
        panel.classList.remove('translate-x-full');

        let closed = false;

        function close() {
            if (closed) return;
            closed = true;

            document.removeEventListener('keydown', keyHandler, true);
            if (typeof options.onClose === 'function') options.onClose();

            backdrop.classList.replace('opacity-100', 'opacity-0');
            panel.classList.add('translate-x-full');

            window.setTimeout(() => {
                node.remove();
                unlockScroll();
            }, prefersReducedMotion() ? 0 : FADE_MS);

            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
        }

        const keyHandler = trapFocus(node, close);

        backdrop.addEventListener('click', close);

        const closeButton = options.closeId ? node.querySelector('#' + options.closeId) : null;
        if (closeButton) closeButton.addEventListener('click', close);

        return {
            node,
            panel,
            body: node.querySelector('#' + options.id + '-scroll'),
            footerEl: node.querySelector('#' + options.id + '-footer'),
            close
        };
    }

    /**
     * A short question with two or three answers, over whatever is already on
     * screen.
     *
     * options: { host, idPrefix, title, body, actions, dismissible }
     * returns: the close function, or null when one is already open
     *
     * `host` is an element to mount inside — pass an overlay's own node and
     * the layer is `absolute` within it, so it dims that surface and nothing
     * else. Omit it and the layer is `fixed` over the whole page, which is
     * what a surface with no overlay of its own (the cart) needs.
     *
     * `dismissible: false` removes Escape and leaves the actions as the only
     * way out. For a question whose whole point is that it must be answered —
     * merging two carts, where every dismissal would have to silently pick one
     * of the answers anyway.
     *
     * THIS WAS profile-icon-loader.js's, AND THE NOTES ON IT ARE ITS OWN
     * -----------------------------------------------------------------
     * It was extracted the second time a surface needed it, the same move
     * product-section-shared-module.js made for the card and this file made
     * for the overlay. Two things it worked out are load-bearing and are
     * repeated here so they survive the move:
     *
     *   * The keydown handler is on `window`, not `document`. trapFocus above
     *     registers document-capture, and window precedes document in the
     *     capture path — so this runs first and can stop it. On `document` it
     *     would run *second* (capture listeners on one node run in
     *     registration order, and the surface underneath registered first),
     *     and Escape would close the whole overlay out from under the question
     *     it is asking. product-details-module.js guards Escape the same way.
     *   * Tab is answered here and cancelled, never delegated. Whatever is
     *     underneath is still in the DOM and still focusable, so leaving Tab
     *     to the outer trap walks the caret into fields the visitor cannot see
     *     past this layer.
     *
     * ONE AT A TIME, ACROSS ALL CALLERS. Two of these stacked would each
     * install a window handler and the second's Escape would close both. A
     * caller that is refused gets null back and must have an answer of its own
     * for that case — never a silent no-op.
     */
    const DIALOG_FADE_MS = 200;
    const DIALOG_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

    let dialogOpen = false;

    function openChoiceDialog(options) {
        if (dialogOpen) return null;

        const host = options.host || null;
        const mount = host || document.body;
        if (!mount) return null;

        const prefix = options.idPrefix || 'store-dialog';
        const dismissible = options.dismissible !== false;

        dialogOpen = true;

        const lastFocused = document.activeElement;

        const layer = document.createElement('div');
        // The layer scrolls, rather than the box inside it, so a question
        // taller than the phone it is being asked on can be read to the end and
        // its buttons reached. It was previously neither scrollable nor
        // contained: a long body simply ran off the screen. `items-start` above
        // the breakpoint where that can happen keeps a short dialog centred
        // while letting a tall one begin at the top instead of overflowing in
        // both directions at once.
        layer.className = (host ? 'absolute inset-0 z-[110]' : 'fixed inset-0 z-[120]') +
            ' srk-scroll overflow-y-auto flex items-start sm:items-center justify-center p-5 sm:p-8 bg-[#12170f]/60 opacity-0 transition-opacity duration-200 ease-out';
        layer.setAttribute('role', 'alertdialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-labelledby', prefix + '-title');
        layer.setAttribute('aria-describedby', prefix + '-body');

        layer.innerHTML = [
            '<div class="w-full max-w-md bg-white rounded-md shadow-2xl border border-[#12170f]/10 p-6 sm:p-8">',
            '    <h3 id="' + prefix + '-title" class="text-xl font-bold tracking-tight text-[#12170f]">' + escapeHtml(options.title) + '</h3>',
            '    <div id="' + prefix + '-body" class="text-sm text-[#1f271b]/70 leading-relaxed mt-3 space-y-3">' + options.body + '</div>',
            '    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-7">',
                 options.actions.map((action, index) =>
                     '        <button type="button" data-dialog-action="' + index + '" class="' +
                     (action.primary ? PRIMARY_BUTTON_CLASSES + ' text-sm px-6 py-3' : SECONDARY_BUTTON_CLASSES) +
                     '">' + escapeHtml(action.label) + '</button>'
                 ).join('\n'),
            '    </div>',
            '</div>'
        ].join('\n');

        mount.appendChild(layer);

        // Mounted on <body> this is the only thing holding the page still, and
        // mounted inside an overlay the count simply goes to two and back —
        // which is exactly why the lock is counted here rather than assigned
        // per surface.
        lockScroll();

        // Force a reflow so the class swap animates rather than being
        // coalesced into the same paint — the step openOverlay takes too.
        void layer.offsetWidth;
        layer.classList.replace('opacity-0', 'opacity-100');

        let closed = false;

        function close() {
            if (closed) return;
            closed = true;
            dialogOpen = false;

            window.removeEventListener('keydown', onKeydown, true);
            layer.classList.replace('opacity-100', 'opacity-0');

            window.setTimeout(() => {
                layer.remove();
                unlockScroll();
            }, prefersReducedMotion() ? 0 : DIALOG_FADE_MS);

            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus({ preventScroll: true });
            }
        }

        function onKeydown(event) {
            if (event.key === 'Escape') {
                // Swallowed even when this dialog will not act on it. Letting
                // it through would close the surface underneath instead, which
                // is never what Escape meant here.
                event.preventDefault();
                event.stopPropagation();
                if (dismissible) close();
                return;
            }

            if (event.key !== 'Tab') return;

            event.preventDefault();
            event.stopPropagation();

            const focusable = [...layer.querySelectorAll(DIALOG_FOCUSABLE)];
            if (!focusable.length) return;

            const at = focusable.indexOf(document.activeElement);
            const step = event.shiftKey ? -1 : 1;
            const next = (at + step + focusable.length) % focusable.length;

            focusable[next].focus();
        }

        window.addEventListener('keydown', onKeydown, true);

        layer.addEventListener('click', (event) => {
            const button = event.target.closest('[data-dialog-action]');
            if (!button) return;

            const action = options.actions[Number(button.getAttribute('data-dialog-action'))];
            close();
            if (action && typeof action.onPick === 'function') action.onPick();
        });

        // The primary action is last in the row, so Enter on a keyboard lands
        // on the road most people arriving here are taking.
        const primary = layer.querySelector('[data-dialog-action]:last-child');
        if (primary) primary.focus({ preventScroll: true });

        return close;
    }

    // ------------------------------------------------------------------
    // PENDING QUOTE HANDOFF
    // ------------------------------------------------------------------
    // "Send this basket to the quote form" is asked from three places, and one
    // of them is on a different document.
    //
    // The cart drawer and the product details overlay both open the quote form
    // in the page they are already standing in, so handing the selection over
    // on a `window` global worked. The checkout page's "These need a quote"
    // refusal cannot: request-quote-module.js is not loaded on checkout.html
    // (and should not be — that page grants Razorpay's CSP directives and has
    // no store shell to open an overlay over), so the only way there is a
    // navigation to /store/store.html#quote, and a global does not survive one.
    //
    // What that cost was the whole point of the screen. A customer was told
    // "send it as a quote request", clicked the button, and arrived at an empty
    // form — every product they had chosen and every quantity they had set
    // discarded at exactly the moment they were being asked to re-state them.
    // The same drawer button on checkout.html did nothing at all, since the
    // `if (window.requestQuote)` guard around it is false on that page.
    //
    // sessionStorage carries it instead: same tab, same origin, survives the
    // navigation, and dies with the tab like every other view-state key here.
    // It is CONSUMED ON READ — a basket handed over once must not reappear the
    // next time the form is opened from scratch.
    //
    // Product ids and quantities only. The form re-resolves each id against
    // the live catalogue anyway, so a name or a price carried here would be a
    // second copy of something already fetched, able to go stale on the way.
    const PENDING_QUOTE_KEY = 'srk_pending_quote';

    function normaliseQuoteItems(items) {
        return (Array.isArray(items) ? items : [])
            .map(item => {
                const id = item && (item.product_id !== undefined && item.product_id !== null
                    ? item.product_id
                    : item.id);
                if (id === undefined || id === null || id === '') return null;
                const quantity = Number.parseInt(item && item.quantity, 10);
                return {
                    product_id: String(id),
                    quantity: Number.isFinite(quantity) ? Math.max(1, Math.min(99, quantity)) : 1
                };
            })
            .filter(Boolean)
            .slice(0, 12);
    }

    const pendingQuote = {
        // Every read and write is wrapped, the rule every storage touch in this
        // codebase follows: a browser that throws on sessionStorage must lose
        // the handoff, not the page.
        put(items) {
            const clean = normaliseQuoteItems(items);
            try {
                if (clean.length) sessionStorage.setItem(PENDING_QUOTE_KEY, JSON.stringify(clean));
                else sessionStorage.removeItem(PENDING_QUOTE_KEY);
            } catch (error) {}
            return clean;
        },

        take() {
            let raw = null;
            try {
                raw = sessionStorage.getItem(PENDING_QUOTE_KEY);
                sessionStorage.removeItem(PENDING_QUOTE_KEY);
            } catch (error) {
                return [];
            }
            if (!raw) return [];
            try {
                return normaliseQuoteItems(JSON.parse(raw));
            } catch (error) {
                return [];
            }
        },

        clear() {
            try { sessionStorage.removeItem(PENDING_QUOTE_KEY); } catch (error) {}
        }
    };

    window.storeOverlay = {
        TOKENS,
        pendingQuote,
        // Spread flat as well, because reading `TOKENS.FIELD_CLASSES` inside a
        // template array is noise where `FIELD_CLASSES` is not. Both names
        // point at the same string.
        FIELD_CLASSES,
        PRIMARY_BUTTON_CLASSES,
        SECONDARY_BUTTON_CLASSES,
        ICON_BUTTON_CLASSES,
        EYEBROW_CLASSES,
        SHELL,

        icon,
        CLOSE_ICON,
        CHEVRON_ICON,
        TRASH_ICON,
        PLUS_ICON,
        MINUS_ICON,
        CHECK_ICON,
        BAG_ICON,
        USER_ICON,
        SEARCH_ICON,
        PACKAGE_ICON,

        ensureStyles,
        prefersReducedMotion,
        enhance,
        escapeHtml,

        headerHTML,
        drawerHeaderHTML,
        sectionHeading,
        centredMessageHTML,
        labelHTML,
        errorHTML,
        textFieldHTML,
        textAreaHTML,
        bannerHTML,

        fieldError,
        clearFieldError,
        syncSelectTrigger,
        clearErrorsIn,

        trapFocus,
        FOCUSABLE,
        openOverlay,
        openDrawer,
        openChoiceDialog,
        FADE_MS,
        DIALOG_FADE_MS
    };
})();
