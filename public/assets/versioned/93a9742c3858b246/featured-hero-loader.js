/**
 * featured-hero-loader.js
 *
 * Fills the store home hero with every product the admin has flagged
 * `is_featured`, and drives it as a slideshow.
 *
 * Every slide is built with its content already in place before the first paint —
 * the chevrons only move the track, they never fetch or fill anything. Clicking
 * through is therefore instant, and the whole carousel costs one API call.
 *
 * Data comes from GET /api/products/public, which already returns only active
 * products and only the customer-facing fields.
 */
(() => {
    'use strict';

    // Slides alternate through the brand's dark grounds so consecutive products
    // read as distinct panels rather than one long block.
    const BACKDROPS = ['#2a3424', '#420c14', '#1f271b'];
    const SLIDE_MS = 700;

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const prefersReducedMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function imagePanel(product) {
        const name = escapeHtml(product.name);

        if (product.image_url) {
            return '<img src="' + escapeHtml(product.image_url) + '" alt="' + name + '"' +
                ' class="h-full max-h-full w-auto aspect-square object-cover rounded-sm border border-white/20 shadow-inner bg-white/10"' +
                ' loading="lazy" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
                '<div class="h-full max-h-full w-auto aspect-square bg-white/10 backdrop-blur-sm border border-white/20 rounded-sm items-center justify-center text-white/50 text-sm font-semibold shadow-inner text-center px-4" style="display:none">' + name + '</div>';
        }

        return '<div class="h-full max-h-full w-auto aspect-square bg-white/10 backdrop-blur-sm border border-white/20 rounded-sm flex items-center justify-center text-white/50 text-sm font-semibold shadow-inner text-center px-4">' + name + '</div>';
    }

    // `isClone` marks the duplicated edge slides used for the seamless wrap, so
    // screen readers do not announce the same product twice.
    function slide(product, index, total, isClone) {
        const backdrop = BACKDROPS[index % BACKDROPS.length];

        // Reads the dedicated featured copy, never the catalogue description —
        // the two are separate fields precisely so hero copy can be written for
        // the hero.
        //
        // A blank one renders no paragraph at all rather than a house line. A
        // stand-in would be identical on every slide, which reads as a bug and
        // hides the fact that the field simply has not been filled in yet.
        const copy = (product.featured_description || '').trim();
        const description = copy
            ? '      <p class="text-white/80 mb-6 md:mb-8 text-sm md:text-base leading-relaxed max-w-md">' + escapeHtml(copy) + '</p>'
            : '';

        return [
            '<article class="shrink-0 w-full h-full relative" role="group" aria-roledescription="slide"' +
                (isClone ? ' aria-hidden="true" inert' : ' aria-label="' + (index + 1) + ' of ' + total + '"') + '>',
            '  <div class="absolute inset-0 opacity-80 z-0" style="background:' + backdrop + '"></div>',
            '  <div class="relative z-10 w-full flex flex-wrap items-center justify-between px-6 pt-9 pb-16 md:px-20 md:py-14 h-full gap-10 xl:gap-16">',
            '    <div class="flex w-full lg:w-auto lg:flex-1 h-[190px] sm:h-[230px] lg:h-full items-center justify-center py-2 order-1 lg:order-2">',
            '      ' + imagePanel(product),
            '    </div>',
            '    <div class="w-full lg:w-auto max-w-xl order-2 lg:order-1">',
            '      <span class="inline-block px-3 py-1 border border-[#d4af37]/60 bg-[#d4af37]/10 text-[#d4af37] text-[11px] font-bold rounded-sm mb-4 md:mb-5 tracking-[0.14em] uppercase">Featured</span>',
            '      <h2 class="text-2xl md:text-4xl text-white font-bold mb-4 md:mb-5 leading-[1.15] tracking-tight text-balance">' + escapeHtml(product.name) + '</h2>',
            description,
            '      <a href="/store/store.html?product=' + encodeURIComponent(product.id) + '#all-products" data-hero-cta data-product-slug="' + escapeHtml(product.url_slug) + '"',
            '         class="inline-block bg-white text-[#12170f] font-bold px-8 py-3.5 rounded hover:bg-[#d4af37] hover:text-white transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#12170f]">View Product</a>',
            '    </div>',
            '  </div>',
            '</article>'
        ].join('\n');
    }

    // On a phone the slide is a single column of text across the full width, so
    // a vertically centred chevron sits directly on top of the copy — it landed
    // over the first word of the description, and the button won every tap that
    // was meant to select the sentence under it. Below `md` the pair drops into
    // the control strip at the foot of the slide instead, flanking the dots,
    // where the content padding already keeps the ground clear. From `md` up the
    // slide is two columns with the text held to `max-w-xl`, nothing is under
    // them, and they stay where they were.
    function chevron(direction) {
        const isNext = direction === 'next';
        const side = isNext ? 'right-4' : 'left-4';
        const path = isNext ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7';

        return '<button type="button" data-hero-' + direction +
            ' aria-label="' + (isNext ? 'Next' : 'Previous') + ' featured product"' +
            ' class="absolute ' + side + ' bottom-4 md:bottom-auto md:top-1/2 md:-translate-y-1/2' +
            ' w-9 h-9 md:w-10 md:h-10 bg-white/10 hover:bg-[#d4af37] rounded-full flex items-center justify-center text-white backdrop-blur-sm transition-colors duration-300 z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">' +
            '<svg class="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + path + '"></path></svg></button>';
    }

    function dot(product, index) {
        const active = index === 0;
        return '<button type="button" data-hero-dot="' + index + '"' +
            ' aria-label="Show ' + escapeHtml(product.name) + '"' +
            ' aria-pressed="' + (active ? 'true' : 'false') + '"' +
            ' class="w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]">' +
            '<span aria-hidden="true" class="h-1.5 rounded-full ' + (active ? 'w-7 bg-[#d4af37]' : 'w-2.5 bg-white/35') + '"></span></button>';
    }

    function render(section, products) {
        const total = products.length;
        const loops = total > 1;

        // Wrapping with a modulo would rewind the track the whole way from the
        // last slide back to the first, which reads as a jump backwards. Instead
        // the track carries a clone of the last slide before the first, and a
        // clone of the first after the last. Next from the final slide animates
        // forward into that clone, and once it lands the track is repositioned
        // onto the real slide with transitions off — invisible, and the direction
        // of travel never reverses.
        const real = products.map((product, index) => slide(product, index, total, false));
        const trackSlides = loops
            ? [slide(products[total - 1], total - 1, total, true)]
                  .concat(real, [slide(products[0], 0, total, true)])
            : real;

        const controls = loops ? chevron('prev') + chevron('next') : '';
        const dots = loops
            ? '<div class="absolute bottom-3 md:bottom-2 left-1/2 -translate-x-1/2 flex items-center z-20" role="group" aria-label="Choose featured product">' +
              products.map(dot).join('') + '</div>'
            : '';

        section.innerHTML =
            '<div data-hero-track class="flex h-full w-full will-change-transform">' +
            trackSlides.join('\n') + '</div>' + controls + dots;

        const track = section.querySelector('[data-hero-track]');
        const dotEls = Array.prototype.slice.call(section.querySelectorAll('[data-hero-dot]'));
        const reduced = prefersReducedMotion();

        // Index into the extended track, so the first real slide sits at 1
        // whenever the clones are present.
        let position = loops ? 1 : 0;
        let animating = false;

        function paint(animate) {
            track.style.transition = (animate && !reduced)
                ? 'transform ' + SLIDE_MS + 'ms cubic-bezier(0.22, 1, 0.36, 1)'
                : 'none';
            track.style.transform = 'translateX(-' + (position * 100) + '%)';
        }

        function realIndex() {
            if (!loops) return 0;
            return ((position - 1) % total + total) % total;
        }

        function syncDots() {
            const current = realIndex();
            const frames = Array.from(track.children);
            frames.forEach((frame, i) => {
                const active = i === (loops ? current + 1 : current);
                if (!active && frame.contains(document.activeElement)) section.focus({ preventScroll: true });
                frame.inert = !active;
                frame.setAttribute('aria-hidden', String(!active));
                frame.querySelectorAll('a,button').forEach(control => { control.tabIndex = active ? 0 : -1; });
            });
            dotEls.forEach((el, i) => {
                const active = i === current;
                el.setAttribute('aria-pressed', String(active));
                const mark = el.querySelector('span');
                mark.classList.toggle('w-7', active);
                mark.classList.toggle('bg-[#d4af37]', active);
                mark.classList.toggle('w-2.5', !active);
                mark.classList.toggle('bg-white/35', !active);
            });
        }

        // Swap a clone for the real slide it stands in for, transitions off.
        function normalize() {
            if (position === 0) position = total;
            else if (position === total + 1) position = 1;
            else return;

            paint(false);
            void track.offsetWidth; // force a reflow so the next move animates
        }

        function move(to) {
            if (!loops || animating || to === position) return;
            position = to;

            // With transitions off there is no transitionend to wait for, so the
            // correction has to happen inline.
            if (reduced) {
                paint(false);
                normalize();
                syncDots();
                return;
            }

            animating = true;
            paint(true);
            syncDots();
        }

        track.addEventListener('transitionend', (event) => {
            // Hovering the CTA bubbles its own transform transitionend up to the
            // track, which would otherwise clear the lock mid-slide.
            if (event.target !== track || event.propertyName !== 'transform') return;
            animating = false;
            normalize();
        });

        paint(false);
        syncDots();

        const next = section.querySelector('[data-hero-next]');
        const prev = section.querySelector('[data-hero-prev]');

        if (next) next.addEventListener('click', () => move(position + 1));
        if (prev) prev.addEventListener('click', () => move(position - 1));
        dotEls.forEach((el, i) => el.addEventListener('click', () => move(i + 1)));

        section.addEventListener('keydown', (event) => {
            if (!loops) return;
            if (event.key === 'ArrowRight') { event.preventDefault(); move(position + 1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); move(position - 1); }
        });

        // CTAs are ordinary links carrying the exact product id, so refresh,
        // Back and opening in a new tab all keep the visitor's selection.
    }

    async function load() {
        const section = document.getElementById('featured-hero');
        if (!section) return;

        let products = [];

        // THE SHARED CACHE, not a fetch of its own.
        //
        // This asked /api/products/public directly, and so did
        // featured-categories-loader.js for the categories — while
        // product-section-shared-module.js was already holding both behind a
        // promise cached for the life of the page, which every product
        // section, the search overlay, the cart, the quote form and the
        // details overlay read. So a single load of store.html made the same
        // two calls twice: once for this hero, once for everything else.
        //
        // Nothing about that was subtly wrong — it was two extra round trips
        // on the page's critical path, and two chances for this hero to show a
        // different catalogue from the grid directly beneath it, because the
        // two answers were fetched at different moments.
        //
        // loadProducts() rejects on failure and clears its cache so a later
        // caller can retry; that rejection is caught here exactly as the old
        // fetch's was, and lands on the same empty-hero path below.
        try {
            const shared = window.productSection;
            const data = shared && typeof shared.loadProducts === 'function'
                ? await shared.loadProducts()
                : await fetch('/api/products/public', { cache: 'no-store' }).then(r => (r.ok ? r.json() : []));
            products = (Array.isArray(data) ? data : []).filter(item => item.is_featured === true);
        } catch (error) {
            console.error('Featured hero: could not load products.', error);
        }

        // An empty black band reads as a broken page, so with nothing featured the
        // hero removes itself and the sections below simply move up.
        if (!products.length) {
            section.remove();
            return;
        }

        render(section, products);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', load);
    } else {
        load();
    }
})();
