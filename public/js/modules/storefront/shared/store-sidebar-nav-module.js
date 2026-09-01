/**
 * store-sidebar-nav-module.js
 *
 * The store sidebar's own nav-button bookkeeping, extracted from three
 * inline <script> blocks in store.html so the page's script tags can all
 * carry `defer` (P06) — a document with any inline script is left
 * parser-blocking rather than have this run before the elements it queries
 * exist.
 *
 * Three independent pieces, kept in one file because each is a few lines
 * and none depends on the others:
 *
 *   1. The gold active-state swap across every .nav-btn on click.
 *   2. "Home" additionally resets view-state-restore-module.js's saved
 *      section (it is skip-listed there, which stops IT from being saved,
 *      but does not erase a real section saved a moment earlier) and
 *      navigates to the plain store URL.
 *   3. "Assistance" navigates straight to /contact.html.
 */
(() => {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const homeButton = document.querySelector('button[data-policy="home"]');
        const assistanceButton = document.querySelector('button[data-policy="assistance"]');
        const allNavButtons = document.querySelectorAll('.nav-btn');

        if (homeButton) {
            homeButton.addEventListener('click', () => {
                // "home" is skip-listed for view-state-restore-module.js, so
                // it never gets saved as the section to return to — but that
                // alone doesn't erase whatever real section (e.g. All
                // Products) was saved a moment earlier, so without this the
                // reload below just replays that instead of landing here.
                if (window.srkViewState) window.srkViewState.reset();

                window.location.href = '/store/store.html';
            });
        }

        if (assistanceButton) {
            assistanceButton.addEventListener('click', () => {
                window.location.href = '/contact.html';
            });
        }

        allNavButtons.forEach(button => {
            button.addEventListener('click', () => {
                // 1. Remove the active classes from ALL buttons (including
                // home) and add the default hover classes back.
                allNavButtons.forEach(btn => {
                    btn.classList.remove('text-[#d4af37]', 'bg-[#d4af37]/10');
                    btn.classList.add('hover:text-[#d4af37]', 'hover:bg-[#d4af37]/5');
                });

                // 2. Remove the hover classes from the CLICKED button and
                // apply the active classes to it.
                button.classList.remove('hover:text-[#d4af37]', 'hover:bg-[#d4af37]/5');
                button.classList.add('text-[#d4af37]', 'bg-[#d4af37]/10');
            });
        });
    });
})();
