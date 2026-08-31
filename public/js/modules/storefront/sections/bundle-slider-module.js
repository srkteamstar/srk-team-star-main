/**
 * bundle-slider-module.js
 *
 * The "Bought Together" combo cards on the store home view scroll
 * horizontally in a snap-scrolling track; this wires the two chevron
 * buttons to page it one viewport at a time. Extracted from an inline
 * <script> in store.html so the page's script tags can all carry `defer`
 * (P06) — a document with any inline script is left parser-blocking rather
 * than have this run before the elements it queries exist.
 */
(() => {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const slider = document.getElementById('bundle-slider');
        const btnPrev = document.getElementById('bundle-prev');
        const btnNext = document.getElementById('bundle-next');
        if (!slider || !btnPrev || !btnNext) return;

        btnNext.addEventListener('click', () => {
            slider.scrollBy({ left: slider.clientWidth, behavior: 'smooth' });
        });

        btnPrev.addEventListener('click', () => {
            slider.scrollBy({ left: -slider.clientWidth, behavior: 'smooth' });
        });
    });
})();
