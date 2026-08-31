const { test } = require('node:test');
const assert = require('node:assert/strict');
const { siteOrigin, publicPagePaths, renderPageMetadata, sendHtmlPage } = require('../src/core/http/page-metadata');
const html = '<!doctype html><html lang="en"><head><title>Contact</title></head><body><main><h1>Contact</h1></main></body></html>';

test('SEO origin must be a configured HTTPS origin, never a preview Host value', () => {
    const previous = process.env.SITE_ORIGIN;
    try {
        for (const value of ['', 'http://store.example', 'https://user:pass@store.example', 'https://store.example/subpath', 'https://store.example/?x=1', 'https://localhost', 'https://127.0.0.1']) {
            process.env.SITE_ORIGIN = value;
            assert.equal(siteOrigin(), '');
            assert.doesNotMatch(renderPageMetadata(html, '/contact.html'), /rel="canonical"/);
        }
        process.env.SITE_ORIGIN = 'https://store.example';
        assert.equal(siteOrigin(), 'https://store.example');
        assert.match(renderPageMetadata(html, '/index.html'), /rel="canonical" href="https:\/\/store.example\/"/);
    } finally {
        if (previous === undefined) delete process.env.SITE_ORIGIN; else process.env.SITE_ORIGIN = previous;
    }
});

test('Metadata escapes catalogue text and JSON-LD cannot close its script element', () => {
    const result = renderPageMetadata(html, '/products/example', {
        title: '</title><script>alert(1)</script>',
        description: '" onload="alert(1)',
        image: 'javascript:alert(1)',
        schema: { '@type': 'Product', name: '</script><script>alert(1)</script>' }
    });
    assert.doesNotMatch(result, /<script>alert/);
    assert.doesNotMatch(result, /property="og:image"/);
    assert.match(result, /\\u003c\/script>/);
    assert.match(result, /&quot; onload=&quot;/);
});

test('Checkout and payment markup is not rewritten by SEO', () => {
    assert.equal(renderPageMetadata(html, '/store/checkout.html'), html);
    assert.equal(renderPageMetadata(html, '/store/payment.html'), html);
    const urls = publicPagePaths();
    assert(!urls.some(url => /checkout|payment|index\.html|sitemap\.xml/.test(url)));
    assert(urls.includes('/blog/'));
});

test('Rendered JSON-LD adds exact CSP hashes without widening script origins', () => {
    const headers = new Map([['Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'"]]);
    let output;
    const res = { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value), type() { return this; }, send(value) { output = value; return this; } };
    sendHtmlPage({ path: '/' }, res, html);
    assert.match(output, /"@type":"Organization"/);
    assert.match(headers.get('Content-Security-Policy'), /script-src 'self' 'sha256-/);
    assert.doesNotMatch(headers.get('Content-Security-Policy'), /unsafe-inline/);
    assert.equal(headers.get('Cache-Control'), 'no-cache');
});

test('Public product projection keeps inactive/private records out and preserves the test-price safeguard', async () => {
    const repoPath = require.resolve('../src/modules/products/infrastructure/product.repository');
    const cached = require.cache[repoPath];
    require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: {
        fetchProductRows: async () => [
            { id: 9, name: 'Press', price: '10', is_active: true, asset_folder: 'private', internal_notes: 'secret' },
            { id: 10, name: 'Hidden', price: '25', is_active: false }
        ],
        withProductImages: product => product
    } };
    try {
        const { publicCatalogue } = require('../src/modules/products/services/public-catalogue.service');
        const products = await publicCatalogue();
        assert.equal(products.length, 1);
        assert.equal(products[0].price, 'On request');
        assert(!('asset_folder' in products[0]));
        assert(!('internal_notes' in products[0]));
    } finally {
        if (cached) require.cache[repoPath] = cached; else delete require.cache[repoPath];
    }
});
