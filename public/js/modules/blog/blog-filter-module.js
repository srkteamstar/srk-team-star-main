(() => {
    'use strict';

    const SELECTED = ['bg-[#420c14]', 'text-white', 'border-[#420c14]'];
    const UNSELECTED = ['bg-white', 'text-[#1f271b]', 'border-[#12170f]/10'];

    function init() {
        const buttons = Array.from(document.querySelectorAll('[data-blog-filter]'));
        const cards = Array.from(document.querySelectorAll('[data-blog-card]'));
        const empty = document.querySelector('[data-blog-empty]');
        const featureSection = document.querySelector('[data-blog-feature-section]');
        const gridSection = document.querySelector('[data-blog-grid-section]');
        const status = document.getElementById('blog-filter-status');
        if (!buttons.length || !cards.length) return;

        const valid = new Set(buttons.map(button => button.dataset.blogFilter));

        function selectedFromUrl() {
            const value = new URLSearchParams(window.location.search).get('category') || 'all';
            return valid.has(value) ? value : 'all';
        }

        function render(category, updateHistory) {
            let visible = 0;
            cards.forEach(card => {
                const show = category === 'all' || card.dataset.blogCategory === category;
                card.hidden = !show;
                card.classList.toggle('hidden', !show);
                if (show) visible += 1;
            });

            if (featureSection) {
                const featureCard = featureSection.querySelector('[data-blog-card]');
                const hideFeature = !featureCard || featureCard.hidden;
                featureSection.hidden = hideFeature;
                featureSection.classList.toggle('hidden', hideFeature);
            }
            if (gridSection) {
                const gridHasVisibleCard = Array.from(gridSection.querySelectorAll('[data-blog-card]'))
                    .some(card => !card.hidden);
                gridSection.hidden = !gridHasVisibleCard;
                gridSection.classList.toggle('hidden', !gridHasVisibleCard);
            }

            buttons.forEach(button => {
                const active = button.dataset.blogFilter === category;
                button.setAttribute('aria-pressed', String(active));
                button.classList.remove(...(active ? UNSELECTED : SELECTED));
                button.classList.add(...(active ? SELECTED : UNSELECTED));
            });

            if (empty) {
                empty.hidden = visible !== 0;
                empty.classList.toggle('hidden', visible !== 0);
            }
            if (status) status.textContent = visible + (visible === 1 ? ' article shown.' : ' articles shown.');

            if (updateHistory) {
                const url = new URL(window.location.href);
                if (category === 'all') url.searchParams.delete('category');
                else url.searchParams.set('category', category);
                window.history.pushState({ blogCategory: category }, '', url);
            }
        }

        buttons.forEach(button => button.addEventListener('click', () => render(button.dataset.blogFilter, true)));
        window.addEventListener('popstate', () => render(selectedFromUrl(), false));
        render(selectedFromUrl(), false);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
