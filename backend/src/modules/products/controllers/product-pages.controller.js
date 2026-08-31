'use strict';
const express = require('express');
const fs = require('fs');
const paths = require('../../../core/config/paths');
const { escapeHtmlText: escape } = require('../../../shared/text');
const { siteOrigin, publicPagePaths, safeImage, sendHtmlPage } = require('../../../core/http/page-metadata');
const { publicCatalogue, publicProductBySlugOrId, selectMachineryHero } = require('../services/public-catalogue.service');

// The exact string machinery-hero-loader.js's mounted media panel opens
// with (frontend/pages/index.html) — the anchor this splices the
// server-rendered first slide after, so it paints on top of (not behind)
// the pulsing skeleton on the very first frame. Real product photos have no
// known intrinsic size; 390 is the panel's own largest declared box
// (lg:max-w-[390px]/max-h-[390px]), so the hint is honest about the space
// actually reserved rather than a guess at the source file's pixel size.
const HERO_MEDIA_MARKER = /<div data-machinery-hero-placeholder\b[\s\S]*?<\/div>\s*<\/div>/;
const HERO_IMG_BOX = 390;

const productPath = product => '/products/' + encodeURIComponent(product.url_slug || String(product.id));
const descriptionOf = product => String(product.description || product.featured_description || '').trim()
    || `${product.name} is listed in our ${product.category_name || 'frame-making'} range. Contact SRK Team Star to confirm specifications and compatibility.`;

function shell(content) {
    // Reuse the built first-party fonts, theme and styles without duplicating
    // asset hashes or importing any store, account or payment logic.
    const home = fs.readFileSync(paths.INDEX_HTML, 'utf8');
    const styles = (home.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || []).join('\n');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Products | SRK Team Star</title>${styles}</head>
<body class="srk-product-page"><a class="srk-product-skip" href="#main-content">Skip to content</a>
<header class="srk-product-header"><a href="/" aria-label="SRK Team Star home">SRK Team Star</a><nav aria-label="Main navigation"><a href="/products/">Products</a><a href="/store/store.html">Store</a><a href="/contact.html">Contact</a></nav></header>
<main id="main-content" class="srk-product-main">${content}</main><footer class="srk-product-footer"><a href="/legal/privacy-policy.html">Privacy policy</a><a href="/legal/terms-of-service.html">Terms of service</a><a href="/contact.html">Contact SRK Team Star</a></footer></body></html>`;
}
function metadata(product) {
    return { path: productPath(product), title: `${product.name} | SRK Team Star`, description: descriptionOf(product), image: safeImage(product.image_url), imageAlt: product.name };
}
function failure(req, res, status, title) {
    res.status(status).set('X-Robots-Tag', 'noindex');
    if (status === 503) res.set('Retry-After', '300');
    return sendHtmlPage(req, res, shell(`<h1>${escape(title)}</h1><p>Please try again later or <a href="/contact.html">contact our team</a>.</p><p><a href="/store/store.html">Return to the store</a></p>`), { title });
}

function productPagesController() {
    const router = express.Router();
    // The landing hero's first slide, server-rendered so it is in the initial
    // response rather than discovered after JS runs two data fetches
    // (machinery-hero-loader.js). Splices a real <img> right after the
    // existing pulsing placeholder — after, not before, so it paints on top
    // of it on the very first frame instead of behind it — using the exact
    // selection rule that loader already falls back to (see
    // selectMachineryHero()). If no hero is available, or the page no longer
    // contains the anchor this looks for, this changes nothing and hands the
    // request to the ordinary static render; the client-side loader is
    // unaffected either way and hydrates around whatever it finds.
    //
    // Two literal routes, not one array route: tools/verify-boot.js checks
    // the served route table against tools/api-surface.json path for path,
    // and an array route reports as one joined, non-literal entry there.
    const heroHandler = async (req, res, next) => {
        try {
            const hero = await selectMachineryHero();
            if (!hero) return next();

            const html = fs.readFileSync(paths.INDEX_HTML, 'utf8');
            const heroImg = `<img src="${escape(hero.image_url)}" alt="${escape(hero.name)}" `
                + `width="${HERO_IMG_BOX}" height="${HERO_IMG_BOX}" class="absolute inset-0 h-full w-full object-contain" `
                + `data-ssr-hero data-machinery-hero-image data-machinery-hero-slide data-product-id="${escape(String(hero.id))}" `
                + `data-active="true" aria-hidden="false" fetchpriority="high" decoding="async" loading="eager">`;
            const spliced = html.replace(HERO_MEDIA_MARKER, match => match + heroImg);
            if (spliced === html) return next();

            return sendHtmlPage(req, res, spliced, {});
        } catch (_) { return next(); }
    };
    router.get('/', heroHandler);
    router.get('/index.html', heroHandler);
    router.get('/products', async (req, res) => {
        try {
            const products = await publicCatalogue();
            const items = products.map(product => `<li><a href="${escape(productPath(product))}">${escape(product.name)}</a><p>${escape(descriptionOf(product))}</p></li>`).join('');
            return sendHtmlPage(req, res, shell(`<p class="srk-product-eyebrow">Our catalogue</p><h1>Frame-making products</h1><p>Explore machinery, mouldings and hardware. Open a product for details, then continue to the store for a purchase or quotation.</p><ul class="srk-product-list">${items}</ul>`), { path: '/products/', title: 'Frame-making Products | SRK Team Star' });
        } catch (_) { return failure(req, res, 503, 'Catalogue temporarily unavailable'); }
    });
    router.get('/products/:slug', async (req, res) => {
        try {
            // Indexed lookup, not a scan of the whole catalogue: one row by
            // its url_slug, with a numeric-id fallback for old bookmarks.
            const product = await publicProductBySlugOrId(req.params.slug);
            if (!product) return failure(req, res, 404, 'Product not found');
            const meta = metadata(product);
            const origin = siteOrigin();
            // Informational Product data only. No invented offers, stock,
            // ratings, reviews or technical specifications for quote-only items.
            const schemaProduct = { '@type': 'Product', name: product.name, description: descriptionOf(product), sku: String(product.id) };
            if (meta.image) schemaProduct.image = meta.image;
            if (product.category_name) schemaProduct.category = product.category_name;
            if (origin) schemaProduct.url = origin + meta.path;
            meta.schema = { '@context': 'https://schema.org', '@graph': [schemaProduct] };
            if (origin) meta.schema['@graph'].push({ '@type': 'BreadcrumbList', itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: origin + '/' },
                { '@type': 'ListItem', position: 2, name: 'Products', item: origin + '/products/' },
                { '@type': 'ListItem', position: 3, name: product.name, item: origin + meta.path }
            ] });
            const content = `<nav aria-label="Breadcrumb" class="srk-product-breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/products/">Products</a></li><li aria-current="page">${escape(product.name)}</li></ol></nav>
<div class="srk-product-grid">${meta.image ? `<div class="srk-product-photo"><img src="${escape(meta.image)}" alt="${escape(product.name)}" width="800" height="800" fetchpriority="high" decoding="async"></div>` : ''}
<section><p class="srk-product-eyebrow">${escape(product.category_name || 'SRK Team Star catalogue')}</p><h1>${escape(product.name)}</h1><p class="srk-product-description">${escape(descriptionOf(product))}</p><p>Confirm current pricing, specifications and compatibility with our team before ordering.</p><a class="srk-product-cta" href="/store/store.html?product=${encodeURIComponent(product.id)}#all-products">View in store</a><a class="srk-product-secondary" href="/contact.html">Ask about this product</a></section></div>`;
            return sendHtmlPage(req, res, shell(content), meta);
        } catch (_) { return failure(req, res, 503, 'Product temporarily unavailable'); }
    });
    // Preserve all legacy product bookmarks and their overlay behavior while
    // giving crawlers the same preferred URL as the real product links.
    router.get('/store/store.html', async (req, res, next) => {
        if (typeof req.query.product !== 'string') return next();
        try {
            // Indexed lookup by id, not a scan of the whole catalogue.
            const product = await publicProductBySlugOrId(req.query.product);
            if (product) res.locals.pageMetadata = metadata(product);
        } catch (_) { /* The existing client keeps its normal retry/error flow. */ }
        return next();
    });
    router.get('/sitemap.xml', async (req, res) => {
        const origin = siteOrigin();
        res.set('Cache-Control', 'no-cache');
        if (!origin) return res.status(503).set('Retry-After', '300').type('text').send('The public site origin has not been configured.');
        try {
            const urls = [...new Set([...publicPagePaths(), '/products/', ...(await publicCatalogue()).map(productPath)])];
            return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(url => `<url><loc>${escape(origin + url)}</loc></url>`).join('') + '</urlset>');
        } catch (_) { return res.status(503).set('Retry-After', '300').type('text').send('Sitemap temporarily unavailable.'); }
    });
    return router;
}

module.exports = { productPagesController, productPath, descriptionOf };
