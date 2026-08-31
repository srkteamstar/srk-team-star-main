/**
 * view-state-restore-module.js
 *
 * Puts a refreshed page back where the visitor left it — the section they had
 * open and how far down it they had read.
 *
 * Nothing on the public site survives a reload today. The store always reopens
 * on its landing view, the legal pages always reopen on "Company Credentials",
 * and the catalogue always reopens on "All" — so a visitor who refreshes, or
 * follows a link and comes back, starts over. Everything these pages know about
 * where they are lives in DOM state that the reload throws away.
 *
 * WHAT IS SAVED
 * -------------
 * Per page path, in sessionStorage — so it survives a refresh and dies with
 * the tab:
 *
 *   - the id of the last activated control in each group below;
 *   - the scroll position.
 *
 * RESTORING A LOCATION
 * --------------------
 * By clicking the saved control, not by reproducing its effect. Every one of
 * these pages already routes through a click handler, so replaying the click is
 * the only way to land in a state the page itself considers valid — and it can
 * never drift from what the handler does, because it *is* what the handler does.
 * The module therefore has to load last on the page, after the handlers it
 * replays into are registered.
 *
 * `data-skip` on the script tag lists ids that must never be replayed, for
 * controls whose handler navigates rather than swapping content:
 *
 *     <script src="/js/platform/view-state-restore-module.js" data-skip="home,assistance"></script>
 *
 * store.html needs it — its "home" button assigns window.location, so replaying
 * that would reload the page, which would replay it again. The legal pages must
 * *not* skip "home": there it is a policy document, not a redirect. The same id
 * meaning different things on different pages is why this is page-level markup
 * and not a list inside this file.
 *
 * A misconfigured page cannot spin: a restore that is followed by a navigation
 * within LOOP_GUARD_MS is detected on the next load and the saved location is
 * dropped rather than replayed a second time.
 *
 * `window.srkViewState.reset()` clears everything saved for the current page.
 * Skipping a control only stops it from being saved — it does not erase what
 * was saved before it, so a control that reloads the page (like store.html's
 * "home") would otherwise replay whatever real section came right before it.
 * A handler that wants a clean slate calls this itself, right before it
 * navigates; see store.html's "home" button for the only current caller.
 *
 * A GROUP THAT RENDERS ASYNCHRONOUSLY
 * -------------------------------------
 * catalogue.html's filter tabs are built after its own catalogue fetch
 * resolves, so at DOMContentLoaded — the moment this module normally decides
 * what each page has to watch — the 'category' group's selector matches
 * nothing yet, indistinguishable at a glance from a page that will never
 * have one (index.html, contact.html — both load this module with neither
 * group present, today and always). `containerSelector` on a GROUP entry is
 * the difference: it names an element that exists in static markup before
 * the group's own controls do, so `pendingGroups()` can tell "still loading"
 * apart from "absent" and retry briefly rather than deciding once. Every
 * other page's groups carry no `containerSelector` and are decided
 * immediately, exactly as before this existed.
 *
 * RESTORING SCROLL
 * ----------------
 * Not a single scrollTo. Three separate things move the page out from under one:
 * sections fetch their products and grow the document after the fact, the legal
 * loader runs its own smooth scroll to the top on every policy it opens, and
 * lenis re-asserts its own target every frame. So the position is re-applied on
 * an animation-frame loop for RESTORE_WINDOW_MS, which outlasts all three, and
 * stops the moment the visitor touches the wheel, the screen or the keyboard —
 * they get the page back, and the instant they disagree it is theirs.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.__srkViewStateLoaded) return;
    window.__srkViewStateLoaded = true;

    const STORAGE_KEY = 'srk_view_state:' + window.location.pathname;

    // Long enough to outlast an async section fetch and the legal loader's
    // smooth scroll to top, short enough not to feel like the page is stuck.
    const RESTORE_WINDOW_MS = 1500;

    // A restore that navigates does so immediately. Anything slower than this is
    // the visitor clicking something, not the replay.
    const LOOP_GUARD_MS = 2500;

    // How long after a location change to re-read the scroll position. The legal
    // loader animates to the top over roughly half a second; sampling before it
    // settles would save the position the visitor is being moved away from.
    const SETTLE_MS = 700;

    // ------------------------------------------------------------------
    // CONTROL GROUPS
    // ------------------------------------------------------------------
    // Each group names a set of controls that decide what the page is showing.
    // `attribute` is the dataset key holding a control's id.
    //
    // The category row is claimed only on pages with no section nav. On
    // catalogue.html it *is* the page's location. On store.html the same class
    // belongs to the All Products filter row — a control inside a section rather
    // than the section itself, and one whose sub-category pills would pop their
    // dropdown open on being clicked. Restoring the section is the right
    // granularity there.
    const GROUPS = [
        { name: 'policy',   selector: '.nav-btn[data-policy]',        attribute: 'policy' },
        {
            name: 'category', selector: '.category-btn[data-category]', attribute: 'category',
            unless: '.nav-btn[data-policy]',
            // catalogue.html's filter tabs render asynchronously now, after
            // its own catalogue fetch resolves - #category-filters exists in
            // static markup before that, empty. containerSelector is what
            // tells this group's controls are still loading apart from a
            // page that will never have any (index.html and contact.html
            // both load this module with neither group present today, and
            // must not gain a wait they never had) - see pendingGroups().
            containerSelector: '#category-filters'
        }
    ];

    const script = document.currentScript;
    const skip = ((script && script.dataset.skip) || '')
        .split(',').map(value => value.trim()).filter(Boolean);

    function activeGroups() {
        return GROUPS.filter(group => {
            if (!document.querySelector(group.selector)) return false;
            if (group.unless && document.querySelector(group.unless)) return false;
            return true;
        });
    }

    // A group whose own selector matches nothing yet, but whose declared
    // container is already in the document, is one still being populated
    // asynchronously - not one absent from this page. Only the 'category'
    // group carries a containerSelector, so this is empty on every other
    // page regardless of what is or is not on it, which is what keeps this
    // change a no-op everywhere except catalogue.html.
    function pendingGroups() {
        return GROUPS.filter(group => {
            if (!group.containerSelector) return false;
            if (document.querySelector(group.selector)) return false;
            if (group.unless && document.querySelector(group.unless)) return false;
            return !!document.querySelector(group.containerSelector);
        });
    }

    // ------------------------------------------------------------------
    // STORAGE
    // ------------------------------------------------------------------
    // Private browsing modes can throw on both read and write, and a page that
    // fails to remember where it was must still work.
    function read() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    function write(state) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            /* storage unavailable — the page just will not remember */
        }
    }

    function patch(changes) {
        write(Object.assign(read(), changes));
    }

    // ------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------
    // A skip-listed control is, by definition, one whose handler navigates
    // instead of swapping content — but skipping it only stops it from being
    // *saved*. It says nothing about what was already saved a moment earlier,
    // so reloading through it still replays whatever real section came before
    // it. store.html's "home" button is exactly this: it reloads the page to
    // reset the store, but without this, the replay puts the visitor right
    // back on the section they were trying to leave.
    //
    // This is deliberately opt-in per control rather than automatic for every
    // skip-listed id — "assistance" also skips (it navigates to
    // contact.html), but a visitor who steps away for help and comes back to
    // the store should still land where they were, not be reset. Only "home"
    // wants forgetting; only its own handler calls this, right before it
    // navigates.
    window.srkViewState = {
        reset: function () { write({}); }
    };

    // ------------------------------------------------------------------
    // SCROLL
    // ------------------------------------------------------------------
    // Lenis animates towards its own target every frame, so a bare
    // window.scrollTo() is undone on the next one. Where it is running, it has
    // to be the one told to move.
    function scrollPageTo(position) {
        if (window.lenis && typeof window.lenis.scrollTo === 'function') {
            window.lenis.scrollTo(position, { immediate: true, force: true });
            return;
        }
        // 'instant' rather than the default, which would inherit a smooth
        // scroll-behavior from CSS and lose a race with the next re-apply.
        window.scrollTo({ top: position, left: 0, behavior: 'instant' });
    }

    let saving = true;

    function startSavingScroll() {
        let queued = false;

        window.addEventListener('scroll', () => {
            if (!saving || queued) return;
            queued = true;

            requestAnimationFrame(() => {
                queued = false;
                if (saving) patch({ scroll: window.scrollY });
            });
        }, { passive: true });
    }

    function restoreScroll(target) {
        if (!(target > 0)) {
            saving = true;
            return;
        }

        const deadline = Date.now() + RESTORE_WINDOW_MS;
        let stopped = false;

        const stop = () => {
            if (stopped) return;
            stopped = true;
            saving = true;

            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
            window.removeEventListener('keydown', stop);
        };

        // The visitor always outranks the replay.
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchstart', stop, { passive: true });
        window.addEventListener('keydown', stop);

        const step = () => {
            if (stopped) return;

            if (Date.now() > deadline) {
                stop();
                return;
            }

            // Only correct a position that has actually drifted, so a page that
            // settles early is left alone for the rest of the window.
            if (Math.abs(window.scrollY - target) > 1) scrollPageTo(target);

            requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
    }

    // ------------------------------------------------------------------
    // LOCATION
    // ------------------------------------------------------------------
    function watchLocations(groups) {
        // Capture, so a handler that stops propagation cannot hide the click.
        document.addEventListener('click', (event) => {
            groups.forEach(group => {
                const control = event.target.closest(group.selector);
                if (!control) return;

                const id = control.dataset[group.attribute];
                if (!id || skip.indexOf(id) !== -1) return;

                const location = Object.assign(read().location || {}, { [group.name]: id });
                patch({ location });

                // The click may move the page itself — the legal loader scrolls
                // every policy to the top. Re-read once that has played out, so
                // what is saved is where the visitor actually ended up.
                window.setTimeout(() => {
                    if (saving) patch({ scroll: window.scrollY });
                }, SETTLE_MS);
            });
        }, true);
    }

    function restoreLocations(groups, saved) {
        let replayed = false;

        groups.forEach(group => {
            const id = saved[group.name];
            if (!id || skip.indexOf(id) !== -1) return;

            const control = [...document.querySelectorAll(group.selector)]
                .find(candidate => candidate.dataset[group.attribute] === id);

            if (!control) return;

            control.click();
            replayed = true;
        });

        return replayed;
    }

    // ------------------------------------------------------------------
    // START
    // ------------------------------------------------------------------
    function start() {
        const state = read();

        // A replay that navigated shows up here as a restore stamp from moments
        // ago. Drop the location rather than walk into it again.
        const looping = state.restoredAt && (Date.now() - state.restoredAt) < LOOP_GUARD_MS;
        if (looping) {
            patch({ location: {}, restoredAt: 0 });
            state.location = {};
        }

        // Most pages know everything they will ever know about their groups
        // the instant this runs - the check below is then a single pass with
        // zero delay, exactly as before this existed. Only a page with a
        // pending group (today: catalogue.html, whose filter tabs have not
        // rendered yet) waits, and only up to RESTORE_WINDOW_MS - the same
        // window scroll restoration already grants an async section fetch,
        // for the identical reason.
        if (pendingGroups().length) {
            const deadline = Date.now() + RESTORE_WINDOW_MS;

            const tryAgain = () => {
                if (!pendingGroups().length || Date.now() > deadline) {
                    proceed(activeGroups(), state);
                    return;
                }
                requestAnimationFrame(tryAgain);
            };

            requestAnimationFrame(tryAgain);
        } else {
            proceed(activeGroups(), state);
        }
    }

    function proceed(groups, state) {
        watchLocations(groups);
        startSavingScroll();

        // Nothing is saved while the replay is in flight: the document is still
        // short, so window.scrollY is clamped to less than the target and would
        // overwrite it with the clamped value.
        saving = false;

        // A hash outranks the saved view. `/catalogue.html#machinery` and
        // `/store/store.html#all-products` are how an off-page CTA names a
        // place, and their own handlers act on it at DOMContentLoaded - before
        // this module, which loads last. Replaying a saved tab over that would
        // undo the link the visitor actually followed. The scroll goes with it:
        // a deep link asks for the top of somewhere, not the offset of the last
        // visit. Saving stays on, so whatever they do next is still recorded.
        //
        // `#quote` never reaches here - request-quote-module.js strips it as it
        // opens, and the overlay covers the section behind it either way.
        const deepLinked = window.location.hash.length > 1;

        const replayed = !deepLinked && restoreLocations(groups, state.location || {});
        if (replayed) patch({ restoredAt: Date.now() });

        restoreScroll(deepLinked ? 0 : state.scroll);

        // The stamp has served its purpose once the page has stayed put.
        window.setTimeout(() => patch({ restoredAt: 0 }), LOOP_GUARD_MS);
    }

    // The browser's own restore works off the document as it is at load, which
    // for these pages is before any section has fetched anything — it lands on a
    // stale offset and then fights the re-apply below. This module owns it now.
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

    // Must run after the page's own click handlers are registered, which is why
    // this file loads last; DOMContentLoaded listeners fire in registration
    // order, so ours is the last one on the pile.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Restored from the back/forward cache: the page comes back whole, scroll
    // included, so replaying anything would only disturb it.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) saving = true;
    });
})();
