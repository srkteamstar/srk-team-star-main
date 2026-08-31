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

        // HYDRATION. product-pages.controller.js server-renders this exact
        // markup for entries[0] from the same catalogue projection, so the
        // hero is visible before this script — or its two data fetches —
        // ever runs. Reuse that element as slide 0 instead of appending a
        // second image on top of it; only adopt it when the product it was
        // rendered for still matches the one this fetch resolved as first,
        // since the two reads are not the same request and can disagree
        // (the server-rendered slide is on a short cache, this one is not).
        // A stale mismatch is simply removed — a fresh slide 0 is appended
        // for it below, exactly as if no server-rendered slide existed.
        let ssrHero = stage.querySelector('[data-ssr-hero][data-machinery-hero-image]');
        if (ssrHero && ssrHero.dataset.productId !== entries[0].productId) {
            ssrHero.remove();
            ssrHero = null;
        }
        let hydratedFirstSlide = false;

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
            const hydrating = index === 0 && !!ssrHero;
            const frame = hydrating ? ssrHero : (entry.url ? document.createElement('img') : fallbackFrame(entry, index));
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

                // requestImage(0) is skipped for this slide below — its src
                // is already the one this fetch resolved to — and whether
                // it needs a synthetic load/error (because the real one
                // fired before the listeners above existed to catch it) is
                // decided after this loop, once `slides` actually holds it:
                // the error listener above reindexes through slides.indexOf,
                // which cannot find this frame until it does.
                if (hydrating) {
                    hydratedFirstSlide = true;
                    requested[0] = true;
                }
            } else if (index === 0 && placeholder) {
                placeholder.style.display = 'none';
            }

            if (!hydrating) stage.appendChild(frame);
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

        // WCAG 2.2.2 requires this hero to be pausable — it rotates on its
        // own every ROTATE_MS — but the control that satisfies that has no
        // business reading as a third, equally weighted call to action next
        // to "Explore Machinery" / "View Store". So it is icon-only, sitting
        // in the image's own corner rather than the CTA row, with its
        // accessible name carried entirely by aria-label since there is no
        // visible text for it to come from.
        if (slides.length > 1) {
            const ICON_PAUSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1"></rect><rect x="14" y="4" width="5" height="16" rx="1"></rect></svg>';
            const ICON_PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8V4z"></path></svg>';

            const pauseButton = document.createElement('button');
            pauseButton.id = 'machinery-hero-pause';
            pauseButton.type = 'button';
            // 28px clears WCAG 2.2's 24px target-size floor. The translucent
            // dark disc is what keeps a white glyph legible over whichever
            // slide happens to be underneath it, light or dark. min-width/
            // min-height are set explicitly, not just width/height: the
            // shared stylesheet still carries a 44px floor on this same id
            // from the button's old labeled-text styling, and min-* is not
            // overridden merely by setting width/height to something smaller
            // — they are different properties, so without this the button
            // rendered at 44px regardless of the 28px set below.
            pauseButton.style.cssText = 'position:absolute;right:10px;bottom:10px;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:none;border-radius:9999px;background:rgba(18,23,15,.6);color:#fff;';
            const labelPause = () => {
                pauseButton.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
                pauseButton.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
            };
            labelPause();
            pauseButton.addEventListener('click', () => { paused = !paused; labelPause(); if (paused) stop(); else start(); });
            stage.appendChild(pauseButton);
        }
        paint(0);
        if (hydratedFirstSlide) {
            // Only now does `slides` hold the hydrated element at index 0,
            // which is what the error listener's slides.indexOf(frame) (and
            // the fallback swap it performs) needs to work correctly — done
            // any earlier, mid-loop, it would find nothing and misfire.
            if (ssrHero.complete) ssrHero.dispatchEvent(new Event(ssrHero.naturalWidth > 0 ? 'load' : 'error'));
            // else: still loading — the listeners already attached above
            // fire naturally when that request finishes.
        } else {
            requestImage(0);
        }
        start();
    }

    // Only used when product-section-shared-module.js failed to load —
    // its own loadProducts() is preferred above and already pages through
    // GET /api/products/public's ?page mode (see that file). This mirrors
    // the same loop rather than trusting one response to be the whole
    // catalogue, for the same reason.
    async function fetchAllProductsFallback() {
        const all = [];
        let page = 1;
        for (;;) {
            const response = await fetch('/api/products/public?page=' + page, { cache: 'no-store' });
            if (!response.ok) return all;
            const body = await response.json();
            const items = Array.isArray(body && body.items) ? body.items : [];
            all.push(...items);
            if (!body || !body.hasMore) break;
            page += 1;
        }
        return all;
    }

    async function load() {
        const heroes = Array.prototype.slice.call(document.querySelectorAll('[data-machinery-hero]'));
        if (!heroes.length) return;

        const shared = window.productSection;

        try {
            const productRequest = shared && typeof shared.loadProducts === 'function'
                ? shared.loadProducts()
                : fetchAllProductsFallback();
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
