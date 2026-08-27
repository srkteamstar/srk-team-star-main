/**
 * featured-categories-loader.js
 *
 * Fills the store home "Shop by Category" row from the admin's category list,
 * showing only the ones flagged as a Featured Category.
 *
 * Reads GET /api/categories/public, which already returns active categories only
 * and only the customer-facing fields, so nothing hidden or inactive can appear
 * here.
 *
 * Each card is the category's cover image with its name underneath. A category
 * with no cover uploaded falls back to the same outline icon the admin table
 * uses for an empty thumbnail, so the row never shows a broken image.
 */
(() => {
    'use strict';

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Same glyph the Categories tab shows for a coverless row.
    const FALLBACK_ICON =
        '<svg class="w-12 h-12 text-[#12170f]/20 group-hover:text-[#d4af37] group-hover:scale-110 transition-all duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>';

    function card(category) {
        const name = escapeHtml(category.name);

        // The icon sits underneath the image rather than instead of it, so an
        // image that 404s reveals the icon instead of an empty white box.
        const cover = category.image_url
            ? '<img src="' + escapeHtml(category.image_url) + '" alt="' + name + '"' +
              ' class="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"' +
              ' loading="lazy" onerror="this.style.display=\'none\'" />'
            : '';

        return [
            '<a href="/store/store.html?category=' + encodeURIComponent(category.id) + '#all-products" data-category-card data-category-slug="' + escapeHtml(category.url_slug) + '"',
            '   class="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-sm transition-all duration-300 hover:drop-shadow-sm hover:-translate-y-1">',
            '    <div class="w-full aspect-square bg-white rounded-sm mb-4 overflow-hidden relative flex items-center justify-center border border-[#12170f]/10 transition-colors group-hover:border-[#d4af37]/50 group-hover:bg-gray-50">',
            '        ' + FALLBACK_ICON,
            '        ' + cover,
            '    </div>',
            '    <h3 class="text-center font-bold text-[#1f271b] group-hover:text-[#d4af37] transition-colors">' + name + '</h3>',
            '</a>'
        ].join('\n');
    }

    async function load() {
        const section = document.getElementById('featured-categories');
        const grid = document.getElementById('featured-categories-grid');
        if (!section || !grid) return;

        let categories = [];

        // The shared cache — see the note in featured-hero-loader.js. This row
        // and the filter tabs below it were fetching the same category tree
        // separately on one page load.
        //
        // loadCategories() deliberately never rejects: the tree only decides
        // how things are grouped, so a page that loads without it is still
        // worth showing. It resolves [] instead, which lands on the same
        // "nothing featured, step aside" path this already had.
        try {
            const shared = window.productSection;
            const data = shared && typeof shared.loadCategories === 'function'
                ? await shared.loadCategories()
                : await fetch('/api/categories/public', { cache: 'no-store' }).then(r => (r.ok ? r.json() : []));
            categories = (Array.isArray(data) ? data : []).filter(item => item.is_featured === true);
        } catch (error) {
            console.error('Featured categories: could not load.', error);
        }

        // A heading over an empty row reads as broken, so with nothing featured
        // the whole block steps aside.
        if (!categories.length) {
            section.remove();
            return;
        }

        grid.innerHTML = categories.map(card).join('\n');

        // Real links preserve the category through reload, Back and new tabs.
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', load);
    } else {
        load();
    }
})();
