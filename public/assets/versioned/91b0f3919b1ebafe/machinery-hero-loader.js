/**
 * machinery-hero-loader.js
 *
 * Loads the machinery gallery used by the public landing hero. The store's
 * featured carousel has its own loader and remains intentionally independent.
 * Every active product in the Machinery category contributes one image slide;
 * a main image is preferred, with the catalogue's other image fields used as
 * safe fallbacks for older product rows.
 */
(() => {
    'use strict';

    const ROTATE_MS = 2500;
    const FADE_MS = 700;

    const prefersReducedMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const normalise = value => String(value == null ? '' : value).trim().toLowerCase();

    function resolveProductImage(product, shared) {
        if (shared && typeof shared.resolveMainImage === 'function') {
            return shared.resolveMainImage(product) || '';
        }

        const images = Array.isArray(product.images) ? product.images : [];
        const main = images.find(image => image && image.is_main === true && image.url);
        if (main) return String(main.url);
        if (product.image_url) return String(product.image_url);

        const first = images.find(image => image && image.url);
        return first ? String(first.url) : '';
    }

    function machinerySlides(products, categories, shared) {
        const entries = [];
        let machineryKeys = null;

        if (shared && typeof shared.indexCategories === 'function' && typeof shared.subtreeKeys === 'function') {
            const machinery = (Array.isArray(categories) ? categories : []).find(category =>
                normalise(category.url_slug) === 'machinery' || normalise(category.name) === 'machinery');

            if (machinery) {
                const tree = shared.indexCategories(categories);
                machineryKeys = shared.subtreeKeys(tree, String(machinery.id));
            }
        }

        (Array.isArray(products) ? products : []).forEach(product => {
            // If categories are temporarily unavailable, the joined category
            // name still lets direct Machinery products appear in the hero.
            const belongsToMachinery = machineryKeys
                ? machineryKeys.has(String(product.category_id))
                : normalise(product.category_name) === 'machinery';
            if (!belongsToMachinery) return;

            entries.push({
                url: resolveProductImage(product, shared),
                name: String(product.name || 'Frame-making machinery'),
                productId: String(product.id == null ? '' : product.id)
            });
        });

        return entries;
    }

    function fallbackFrame(entry, index) {
        const fallback = document.createElement('div');
        fallback.className = 'absolute inset-0 flex items-center justify-center bg-white/5';
        fallback.setAttribute('role', 'img');
        fallback.setAttribute('aria-label', entry.name + ' image unavailable');
        fallback.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
        fallback.dataset.machineryHeroSlide = '';
        fallback.dataset.active = index === 0 ? 'true' : 'false';
        return fallback;
    }

    function mountGallery(hero, entries) {
        const stage = hero.querySelector('[data-machinery-hero-media]');
        if (!stage || !entries.length) return;

        const placeholder = stage.querySelector('[data-machinery-hero-placeholder]');
        const reduced = prefersReducedMotion();
        let slides = [];
        let current = 0;
        let timer = null;
        let inView = true;
        let nextLoad = null;
        let paused = reduced;
        const ready = entries.map(entry => !entry.url);
        const requested = entries.map(() => false);

        function requestImage(index) {
            const frame = slides[index];
            if (!frame || frame.tagName !== 'IMG' || requested[index]) return;
            requested[index] = true;
            // Opacity-zero slides are still in the viewport, so native lazy
            // loading alone downloads the entire carousel. Withhold src until
            // needed; once requested, eager loading avoids stalling a hidden
            // next slide. Only the first receives high network priority.
            frame.loading = 'eager';
            frame.src = entries[index].url;
        }

        function prepareNext() {
            if (paused || !ready[0] || slides.length < 2 || document.hidden || !inView || nextLoad !== null) return;
            nextLoad = window.setTimeout(() => {
                nextLoad = null;
                if (!paused && !document.hidden && inView) requestImage((current + 1) % slides.length);
            }, 300);
        }

        function settled(index) {
            ready[index] = true;
            if (index === current && placeholder) placeholder.style.display = 'none';
            start();
            prepareNext();
        }

        entries.forEach((entry, index) => {
            const frame = entry.url ? document.createElement('img') : fallbackFrame(entry, index);
            frame.style.opacity = index === 0 ? '1' : '0';
            frame.style.transition = reduced ? 'none' : 'opacity ' + FADE_MS + 'ms ease-in-out';
            frame.dataset.machineryHeroSlide = '';
            frame.dataset.productId = entry.productId;
            frame.dataset.active = index === 0 ? 'true' : 'false';

            if (frame.tagName === 'IMG') {
                frame.alt = entry.name;
                frame.loading = index === 0 ? 'eager' : 'lazy';
                frame.decoding = 'async';
                frame.fetchPriority = index === 0 ? 'high' : 'low';
                frame.dataset.src = entry.url;
                // Let the artwork follow the responsive panel dimensions;
                // the panel itself controls the overall scale consistently.
                frame.className = 'absolute inset-0 h-full w-full object-contain';
                frame.dataset.machineryHeroImage = '';
                frame.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');

                frame.addEventListener('load', () => {
                    // Keep the previous slide on screen until the next image
                    // can actually be painted, not merely until its request ends.
                    const decoded = typeof frame.decode === 'function' ? frame.decode() : Promise.resolve();
                    decoded.catch(() => {}).then(() => settled(index));
                });

                frame.addEventListener('error', () => {
                    const slideIndex = slides.indexOf(frame);
                    const fallback = fallbackFrame(entry, slideIndex === current ? current : slideIndex);
                    fallback.style.opacity = frame.style.opacity;
                    fallback.style.transition = frame.style.transition;
                    fallback.dataset.productId = entry.productId;
                    frame.replaceWith(fallback);
                    if (slideIndex !== -1) slides[slideIndex] = fallback;
                    if (slideIndex === current) paint(current);
                    settled(index);
                });
            } else if (index === 0 && placeholder) {
                placeholder.style.display = 'none';
            }

            stage.appendChild(frame);
            slides.push(frame);
        });

        function paint(next) {
            slides.forEach((image, index) => {
                const active = index === next;
                image.style.opacity = active ? '1' : '0';
                image.dataset.active = active ? 'true' : 'false';
                image.setAttribute('aria-hidden', active ? 'false' : 'true');
            });
        }

        function advance() {
            if (slides.length < 2) return;
            const next = (current + 1) % slides.length;
            if (!ready[next]) { requestImage(next); return; }
            current = next;
            paint(current);
            prepareNext();
        }

        function stop() {
            if (nextLoad !== null) { window.clearTimeout(nextLoad); nextLoad = null; }
            if (!timer) return;
            window.clearInterval(timer);
            timer = null;
        }

        function start() {
            if (paused || !ready[0] || slides.length < 2 || document.hidden || !inView || timer) return;
            timer = window.setInterval(advance, ROTATE_MS);
            prepareNext();
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stop();
            else start();
        });

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(records => {
                inView = records.some(record => record.isIntersecting);
                if (inView) start();
                else stop();
            }, { threshold: 0.05 });
            observer.observe(hero);
        }

        if (slides.length > 1) {
            const pauseButton = document.createElement('button');
            pauseButton.id = 'machinery-hero-pause';
            pauseButton.type = 'button';
            // Inline, not a shared stylesheet rule: this is a small, secondary
            // slideshow control, not a call to action, and it should read that
            // way without touching styling any other page depends on. The
            // 24/32px minimums stay above WCAG 2.2's 24px target-size floor.
            pauseButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:32px;padding:4px 10px;border:none;border-radius:6px;color:rgba(255,255,255,.55);background:transparent;font-size:12px;';
            const labelPause = () => { pauseButton.textContent = paused ? 'Play slideshow' : 'Pause slideshow'; };
            labelPause();
            pauseButton.addEventListener('click', () => { paused = !paused; labelPause(); if (paused) stop(); else start(); });
            // Its own slot directly under the image, not the CTA row: a
            // utility control for the slideshow should not read as a third,
            // equally weighted call to action next to "Explore Machinery" and
            // "View Store".
            const controls = hero.querySelector('[data-machinery-hero-controls]');
            if (controls) controls.appendChild(pauseButton);
        }
        paint(0);
        requestImage(0);
        start();
    }

    async function load() {
        const heroes = Array.prototype.slice.call(document.querySelectorAll('[data-machinery-hero]'));
        if (!heroes.length) return;

        const shared = window.productSection;

        try {
            const productRequest = shared && typeof shared.loadProducts === 'function'
                ? shared.loadProducts()
                : fetch('/api/products/public', { cache: 'no-store' }).then(response => response.ok ? response.json() : []);
            const categoryRequest = shared && typeof shared.loadCategories === 'function'
                ? shared.loadCategories()
                : fetch('/api/categories/public', { cache: 'no-store' }).then(response => response.ok ? response.json() : []);
            const result = await Promise.all([productRequest, categoryRequest]);
            const entries = machinerySlides(result[0], result[1], shared);

            heroes.forEach(hero => mountGallery(hero, entries));
        } catch (error) {
            // The copy and CTAs remain useful if catalogue imagery is temporarily
            // unavailable, so the static placeholder stays in place.
            console.error('Machinery hero: could not load product imagery.', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', load);
    } else {
        load();
    }
})();
