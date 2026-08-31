/**
 * scroll-lock-module.js
 *
 * Holds the page still while something is open over it, and gives it back
 * exactly where it was.
 *
 * WHAT WAS WRONG
 * --------------
 * Every overlaid surface on this site — the store's overlays and cart drawer,
 * the confirm dialogs, the quote form, the mobile navigation panel — locked the
 * page the same way:
 *
 *     document.body.style.overflow = 'hidden';
 *
 * On a desktop browser that holds. On a phone it does not, and the bug that
 * follows is the one this file exists for: `overflow:hidden` on <body> does not
 * stop iOS Safari scrolling the document, so a drag that ran past the end of the
 * overlay's own scrolling region carried on into the page underneath. The
 * customer reading a product overlay reached the bottom of it, kept going, and
 * the store scrolled away behind a surface that stayed pinned to the viewport —
 * then closed onto somewhere they had never navigated to.
 *
 * There are two separate mechanics behind that, and both need answering:
 *
 *   1. THE LOCK DID NOT HOLD. `overflow:hidden` on <body> is advisory on iOS.
 *      `position:fixed` is not: a fixed body has no scrollport of its own, so
 *      there is nothing left to scroll. The cost is that fixing it discards the
 *      scroll position, which is why this file records it and puts it back.
 *
 *   2. THE DRAG CHAINED. Even with the page held, a touch that runs past the
 *      end of an inner scroller propagates outward looking for the next thing
 *      that will move — the browser's default `overscroll-behavior: auto`. That
 *      is what produces the rubber-band, the pull-to-refresh, and on Android the
 *      handoff to the document. The lock cannot answer this one; it is answered
 *      at each scrolling region with `overscroll-behavior: contain`, which every
 *      overlaid scroller on this site now carries.
 *
 * So: this file stops the page moving, and `contain` stops the gesture ever
 * being offered to it. Neither is sufficient alone.
 *
 * WHY IT IS COUNTED
 * -----------------
 * Surfaces nest — a confirm dialog opens over the cart drawer, which is itself
 * over the store — and each end of that nesting used to unlock the page while
 * the other was still open. The count lives here, once, so any number of
 * surfaces can lock and only the last one out restores.
 *
 * That count is also why this is a platform module and not a helper inside the
 * store's overlay file: the mobile nav panel is on all 17 documents, the store
 * overlays on two, and a page carrying both needs them counting against the
 * SAME number. Two private counters would each think they were alone.
 *
 * WHY IT IS LOADED FIRST
 * ----------------------
 * It has no dependencies and every locking surface needs it, so it goes ahead of
 * responsive-navigation-module.js on every page. A surface that finds it missing
 * falls back to the old `overflow:hidden` rather than not locking at all — worse
 * on a phone, but never nothing.
 *
 * LENIS
 * -----
 * The marketing pages run Lenis, which drives scrolling from its own rAF loop
 * and re-asserts a target every frame. It would fight both halves of this — the
 * hold and the restore — so it is stopped for the duration and told where the
 * page ended up before it starts again. view-state-restore-module.js talks to it
 * the same way and for the same reason.
 */
(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.srkScrollLock) return;

    // ------------------------------------------------------------------
    // THE OTHER HALF, AS ONE CLASS
    // ------------------------------------------------------------------
    // Point 2 of the header, in the form every scrolling region inside an
    // overlaid surface can opt into. It lives here rather than in the store's
    // overlay stylesheet because the surfaces that need it are not all the
    // store's — the mobile nav panel, the quote picker's grid and the store
    // overlays are three different files, and a rule copied into each is the
    // near-miss duplicate this codebase keeps deleting.
    //
    // `contain` and not `none`: the region should still bounce at its own ends,
    // it just must not hand the gesture on to whatever is behind it.
    //
    // Injected rather than written into a stylesheet because this module is a
    // single file loaded on all 17 documents and several of them build their
    // chrome in JavaScript anyway. Same one-sheet-once idiom as
    // custom-select-module.js and the overlay module's ensureStyles.
    const STYLE_ID = 'srk-scroll-lock-styles';

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = '.srk-scroll{overscroll-behavior:contain;}';
        (document.head || document.documentElement).appendChild(style);
    }

    // ------------------------------------------------------------------
    // THE LOCK
    // ------------------------------------------------------------------
    // How many surfaces are currently holding the page. See the header: this
    // being shared across all of them is the whole point of the module.
    let depth = 0;

    // What the page looked like before the first of them locked it. Null
    // whenever depth is 0.
    let held = null;

    function scrollTop() {
        return window.scrollY || window.pageYOffset ||
               (document.documentElement && document.documentElement.scrollTop) || 0;
    }

    // Restoring an inline style means restoring the ATTRIBUTE, not clearing the
    // handful of properties this file happens to set. Something else may own an
    // inline style on <body> — and blanking `body.style.overflow` on the way out
    // is exactly how the old per-surface locks would have trampled it.
    function snapshot(element) {
        return element.getAttribute('style');
    }

    function restoreStyle(element, value) {
        if (value === null) element.removeAttribute('style');
        else element.setAttribute('style', value);
    }

    function lock() {
        depth += 1;
        if (depth > 1) return;

        const body = document.body;
        const html = document.documentElement;
        if (!body || !html) return;

        const y = scrollTop();

        // The width the scrollbar was occupying. A fixed <body> has no
        // scrollbar, so without this the page silently widens by ~15px the
        // instant an overlay opens and narrows again when it closes — every
        // centred thing behind the overlay twitching sideways. Zero on any
        // phone, and on any desktop with overlay scrollbars.
        const gutter = Math.max(0, window.innerWidth - html.clientWidth);

        held = {
            y: y,
            body: snapshot(body),
            html: snapshot(html),
            lenis: !!(window.lenis && typeof window.lenis.stop === 'function')
        };

        if (held.lenis) window.lenis.stop();

        // Kills the rubber-band and the pull-to-refresh on the document itself.
        // The overlaid scrollers carry `contain` rather than `none`, because
        // they are meant to bounce at their own ends — just not to hand the
        // gesture on.
        html.style.overscrollBehavior = 'none';

        // `position:fixed` is the half that actually holds on iOS. top:-y keeps
        // the page looking untouched while it is pinned: the document is still
        // laid out from the top, so the viewport has to be offset by exactly
        // what was scrolled away.
        body.style.position = 'fixed';
        body.style.top = (-y) + 'px';
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        // Still set, and not redundant: it is what holds the page on the
        // browsers where `position:fixed` alone would leave a scrollport.
        body.style.overflow = 'hidden';
        if (gutter > 0) body.style.paddingRight = gutter + 'px';
    }

    function unlock() {
        if (depth === 0) return;

        depth -= 1;
        if (depth > 0 || !held) return;

        const body = document.body;
        const html = document.documentElement;
        const previous = held;
        held = null;

        if (!body || !html) return;

        restoreStyle(body, previous.body);
        restoreStyle(html, previous.html);

        // Instant, not smooth. The page never visibly moved, so this is not a
        // scroll — it is undoing the offset that made it look as though it had
        // not. Animating it would be animating a lie.
        try {
            window.scrollTo({ top: previous.y, left: 0, behavior: 'instant' });
        } catch (error) {
            // 'instant' is recent enough that a browser may still reject the
            // options form outright.
            window.scrollTo(0, previous.y);
        }

        // Lenis holds its own idea of where the page is and would animate back
        // to it on the next frame, undoing the line above.
        if (previous.lenis && window.lenis) {
            if (typeof window.lenis.scrollTo === 'function') {
                window.lenis.scrollTo(previous.y, { immediate: true, force: true });
            }
            if (typeof window.lenis.start === 'function') window.lenis.start();
        }
    }

    window.srkScrollLock = {
        lock: lock,
        unlock: unlock,
        // For a surface that needs to know whether anything is holding the page
        // — and for the tests, which assert the count returns to zero rather
        // than inferring it from a style attribute.
        depth: () => depth
    };
})();
