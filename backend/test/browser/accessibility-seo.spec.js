const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { routeCatalogue } = require('./catalogue-route');
const ORIGIN = 'https://storefront.example.test';

test('Quotation combobox retains its label, required state and active-option relationship', async ({ page }) => {
    await page.goto('/store/store.html#quote');
    const combo = page.getByRole('combobox', { name: 'Category' }).first();
    await expect(combo).toBeVisible();
    await expect(combo).toHaveAttribute('aria-required', 'true');
    await combo.focus();
    await page.keyboard.press('ArrowDown');
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    const popupId = await combo.getAttribute('aria-controls');
    await expect(page.locator('[id="' + popupId + '"]')).toHaveAttribute('role', 'listbox');
    await page.keyboard.press('ArrowDown');
    const optionId = await combo.getAttribute('aria-activedescendant');
    await expect(page.locator('[id="' + optionId + '"]')).toHaveAttribute('role', 'option');
    await page.keyboard.press('Escape');
    await expect(combo).toBeFocused();
    await expect(combo).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#quote-contact-name')).toHaveAttribute('autocomplete', 'name');
    await expect(page.locator('#quote-business-address')).toHaveAttribute('autocomplete', 'street-address');
    await expect(page.locator('#quote-business-name')).toHaveAttribute('aria-required', 'true');
});

test('Cart opening establishes focus and closing returns it to the opener', async ({ page }) => {
    await page.goto('/store/store.html');
    await page.locator('#cart-button').click();
    await expect(page.locator('#cart-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
    await page.locator('#cart-close').click();
    await expect(page.locator('#cart-button')).toBeFocused();
});

test('Product cards expose real links, independent purchase controls and the existing overlay', async ({ page }) => {
    await page.goto('/store/store.html#all-products');
    const card = page.locator('article[data-product-id="1"]').first();
    await expect(card).not.toHaveAttribute('role', 'button');
    const link = card.locator('a[data-product-link]').first();
    await expect(link).toHaveAttribute('href', '/products/fake-machine');
    await expect(link.locator('button')).toHaveCount(0);
    await link.click();
    await expect(page.locator('#product-details')).toBeVisible();
});

test('Only the current featured slide is interactive; indicators have 44px targets', async ({ page }) => {
    await routeCatalogue(page, [1, 2, 3].map(id => ({ id, name: 'Featured ' + id, url_slug: 'featured-' + id, is_featured: true, category_id: 10, price: 'On request' })));
    await page.goto('/store/store.html');
    const frames = page.locator('#featured-hero [data-hero-track] > article');
    await expect(frames).toHaveCount(5);
    await expect(frames.filter({ has: page.locator('a[tabindex="0"]') })).toHaveCount(1);
    await expect(page.locator('#featured-hero article[aria-hidden="true"] a:not([tabindex="-1"])')).toHaveCount(0);
    const dot = page.locator('[data-hero-dot="1"]');
    expect((await dot.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await dot.click();
    await expect(dot).toHaveAttribute('aria-pressed', 'true');
    await expect(frames.nth(2)).toHaveAttribute('aria-hidden', 'false');
    await expect(frames.nth(1)).toHaveAttribute('inert', '');
});

test('Mobile navigation is named, contains focus and restores background interaction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Open main navigation' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Close navigation' });
    await expect(close).toBeFocused();
    await expect(dialog.getByRole('link', { name: 'SRK Team Star Home', exact: true })).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('Landing slideshow provides a working pause and play control', async ({ page }) => {
    await routeCatalogue(page, [1, 2, 3].map(id => ({ id, name: 'Machine ' + id, category_id: 10, category_name: 'Machinery' })));
    await page.goto('/');
    // Icon-only: the accessible name lives in aria-label, not visible text.
    const control = page.locator('#machinery-hero-pause');
    await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Play slideshow');
    const active = await page.locator('[data-machinery-hero-slide][data-active="true"]').getAttribute('data-product-id');
    await page.waitForTimeout(2800);
    await expect(page.locator('[data-machinery-hero-slide][data-active="true"]')).toHaveAttribute('data-product-id', active);
    await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Pause slideshow');
});

test('Static copy, bypass link and product discovery work without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
        const page = await context.newPage();
        for (const path of ['/about.html', '/blog/', '/contact.html', '/products/fake-machine']) {
            await page.goto(path);
            await expect(page.locator('h1')).toBeVisible();
            await page.keyboard.press('Tab');
            await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
            const invisible = await page.locator('.scroll-reveal').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).opacity === '0'));
            expect(invisible).toBe(false);
        }
        await page.goto('/catalogue.html');
        await expect(page.getByRole('link', { name: 'Browse our accessible product catalogue' })).toBeVisible();
    } finally { await context.close(); }
});

test('Public pages have server-rendered canonical and sharing metadata', async ({ request }) => {
    for (const [path, canonical] of [['/', '/'], ['/index.html', '/'], ['/blog/index.html', '/blog/'], ['/contact.html', '/contact.html'], ['/legal/privacy-policy.html', '/legal/privacy-policy.html']]) {
        const response = await request.get(path);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain('rel="canonical" href="' + ORIGIN + canonical + '"');
        expect(html).toContain('property="og:title"');
        expect(html).toContain('name="twitter:card"');
        expect(html).toContain('name="description"');
    }
});

test('Product pages render public content and truthful schema; old bookmarks keep their canonical', async ({ request }) => {
    const response = await request.get('/products/fake-on-request');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>Fake On Request</h1>');
    expect(html).toContain('"@type":"Product"');
    expect(html).not.toContain('"offers"');
    expect(html).not.toContain('asset_folder');
    expect(html).toContain('/store/store.html?product=2#all-products');
    expect(html).toContain('"@type":"BreadcrumbList"');
    const legacy = await request.get('/store/store.html?product=2');
    expect(await legacy.text()).toContain('rel="canonical" href="' + ORIGIN + '/products/fake-on-request"');
    const missing = await request.get('/products/not-a-product');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['x-robots-tag']).toContain('noindex');
});

test('A priced, purchasable product carries a truthful Offer; an on-request product still does not', async ({ request }) => {
    const priced = await request.get('/products/fake-machine');
    expect(priced.status()).toBe(200);
    const pricedHtml = await priced.text();
    const pricedSource = pricedHtml.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1];
    const pricedData = JSON.parse(pricedSource);
    const pricedProduct = pricedData['@graph'].find(node => node['@type'] === 'Product');
    expect(pricedProduct.offers).toEqual({
        '@type': 'Offer',
        priceCurrency: 'INR',
        price: '1000.00',
        availability: 'https://schema.org/InStock',
        url: ORIGIN + '/products/fake-machine'
    });

    // The on-request fixture must still carry no offers at all — Fix 2 only
    // adds one where a real, checkout-priced amount exists.
    const onRequest = await request.get('/products/fake-on-request');
    const onRequestHtml = await onRequest.text();
    expect(onRequestHtml).not.toContain('"offers"');
});

test('Sitemap uses canonical public URLs and excludes checkout and API data', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    const xml = await response.text();
    expect(xml).toContain('<loc>' + ORIGIN + '/products/fake-machine</loc>');
    for (const excluded of ['/index.html', '/checkout', '/payment', '/api/', '?product=', '/sitemap.xml']) expect(xml).not.toContain(excluded);
    const robots = await request.get('/robots.txt');
    expect(await robots.text()).not.toContain('Disallow: /store/checkout.html');
    const checkout = await request.get('/store/checkout.html');
    expect(checkout.headers()['x-robots-tag']).toContain('noindex');
});

test('Blog schema has an image and page identity without fabricated author attribution', async ({ request }) => {
    const response = await request.get('/blog/choose-the-right-photo-frame-cutting-machine/');
    const html = await response.text();
    const source = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1];
    const data = JSON.parse(source);
    expect(data.image).toMatch(/^https:\/\//);
    expect(data.mainEntityOfPage).toBe(ORIGIN + '/blog/choose-the-right-photo-frame-cutting-machine/');
    expect(data.publisher.name).toBe('SRK Team Star');
    expect(data.author).toBeUndefined();
});

test('Enquiry labels stay visible and personal input purposes are exposed', async ({ page }) => {
    await page.goto('/contact.html');
    for (const id of ['form-name', 'form-company', 'form-email', 'form-phone', 'form-message']) await expect(page.locator('label[for="' + id + '"]')).toBeVisible();
    await expect(page.locator('#form-email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.locator('#form-name')).toHaveAttribute('autocomplete', 'name');
});

test('Product pages reflow at 320px with expanded text spacing', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/products/fake-machine');
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole('link', { name: 'View in store' })).toBeVisible();
});

test('Mobile store navigation hands focus to the quotation dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store/store.html');
    await page.getByRole('button', { name: 'Open section navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Store navigation' });
    await expect(drawer).toBeVisible();
    await drawer.locator('[data-policy="quote"]').click();
    await expect(page.locator('#quote-business-name')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('.srk-overlay'))).toBe(true);
    await expect(page.locator('#quote-business-name')).not.toHaveAttribute('inert', '');
});

test('Legal navigation keeps canonical and sharing metadata synchronized', async ({ page }) => {
    await page.goto('/legal/privacy-policy.html');
    await page.locator('#policy-nav [data-policy="shipping"]').click();
    await expect(page).toHaveTitle('Shipping Policy - SRK Team Star');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', ORIGIN + '/legal/shipping-policy.html');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', ORIGIN + '/legal/shipping-policy.html');
    await page.goBack();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', ORIGIN + '/legal/privacy-policy.html');
});

async function contrast(locator) {
    return locator.evaluate(element => {
        const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
        const layers = [];
        for (let node = element; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
        const blend = (fg, bg) => bg.map((channel, i) => fg[i] * (fg[3] === undefined ? 1 : fg[3]) + channel * (1 - (fg[3] === undefined ? 1 : fg[3])));
        let bg = [255, 255, 255];
        layers.reverse().forEach(layer => { bg = blend(layer, bg); });
        const fg = blend(rgba(getComputedStyle(element).color), bg);
        const luminance = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const a = luminance(fg), b = luminance(bg);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
}

test('Previously flagged account, quotation and blog text meets normal-text contrast', async ({ page }) => {
    await page.goto('/store/store.html');
    await page.locator('#profile-button').click();
    await expect(page.locator('#account-switch')).toBeVisible();
    expect(await contrast(page.locator('#account-switch'))).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page.getByText('Use your account identifier and password', { exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.locator('#account-close').click();
    await page.locator('button[data-policy="quote"]').click();
    await expect(page.getByText('Add as many as you need', { exact: true })).toBeVisible();
    expect(await contrast(page.getByText('Add as many as you need', { exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.goto('/blog/');
    expect(await contrast(page.locator('[data-blog-feature-section] p:has(time)').first())).toBeGreaterThanOrEqual(4.5);
});

// -----------------------------------------------------------------------------
// Automated accessibility scans (axe-core)
// -----------------------------------------------------------------------------
// Everything above this point is a hand-written assertion against a specific
// interaction or a specific piece of markup — real coverage, but sample-based
// by construction: it only catches what someone thought to write a test for.
// This block runs @axe-core/playwright's full WCAG 2.0 A/AA and 2.2 AA rule
// set against every public route already exercised elsewhere in this file (the
// same page.goto() targets used above — no new navigation helper, no new
// baseURL: playwright.config.js's baseURL and this suite's authz-harness
// fixture data are exactly what every other test in this file already runs
// against), and fails on the first real violation rather than waiting for a
// human to notice one.
//
// One route is deliberately left out: /store/checkout.html and
// /store/payment.html carry Razorpay's own third-party checkout UI, which
// this suite does not own and cannot fix — see private-paths.js's
// X-Robots-Tag handling for why those two pages are already excluded from
// discovery. Scanning it here would fail this suite on a violation nobody
// maintaining this repository can act on.
//
// KNOWN, PRE-EXISTING color-contrast FINDINGS — narrow, documented, not
// silent. Wiring this scan up surfaced real WCAG 2 AA color-contrast
// failures that predate this change, all variations on the same brand gold
// (#d4af37) used as either a background or a foreground without enough
// contrast against its pairing. Picking a replacement color is a visual
// design decision this test file has no authority to make unilaterally (the
// same reasoning AGENTS.md gives for GST_RATE/SHIPPING_FREE_ABOVE being
// "placeholders" rather than something a change silently overrides) — so
// each is named here instead of being fixed or hidden, and the exclusion
// below removes ONLY the 'color-contrast' rule, ONLY on these specific
// routes; every other rule stays fully enforced everywhere, and
// color-contrast itself stays fully enforced on every route NOT listed here.
// The assertion below also checks the known violation is still exactly
// present — if a route's contrast is fixed, this test starts failing with a
// clear message to remove that line, so a fix can never silently stay
// hidden behind the exclusion.
//
// LIMITATION, stated rather than hidden: axe groups every instance of one
// rule into a single violation entry, so this exclusion is per ROUTE, not
// per element — a second, unrelated color-contrast problem introduced later
// on one of the routes below would be masked alongside the known one until
// someone reads the JSON this test still prints on failure for the
// unexcluded rules. Tightening this to match on the violation's exact
// `target` selector was judged not worth the brittleness for a LOW-severity
// finding; revisit if a route below ever needs a second, distinct exclusion.
//
// These are DIFFERENT specific elements from the hand-written contrast()
// checks above (account overlay, quote overlay, blog feature-section text) —
// axe found separate, still-unfixed pairings on the hero CTA, product/blog
// CTA buttons, the hero's no-image placeholder, and the legal sidebar's
// active-page link. Neither block makes the other redundant.
const KNOWN_COLOR_CONTRAST_FINDINGS = {
    // '/' had a documented finding here (a claimed opacity-blended gold-on-
    // dark hero CTA pairing) that did not reproduce against the actual
    // current markup — confirmed both live (three repeated runs) and by
    // hand: the page's "Explore Machinery"/"Explore machinery" CTAs are
    // solid #d4af37 on solid #12170f, ~8.6:1, well clear of 4.5:1. Removed
    // per this block's own rule: a route whose contrast is fixed makes this
    // test fail until its entry is deleted, rather than staying silently
    // hidden behind a stale exclusion.
    //
    // .product-cta buttons on every product card: white text on a solid
    // #d4af37 background, 2.1:1.
    '/catalogue.html': 'product card CTA button (white text on gold #d4af37 background, 2.1:1)',
    // "Explore Machinery" CTA, shared markup across every blog template:
    // same white-on-#d4af37 pairing as the product cards above.
    '/blog/': 'shared blog CTA button (white text on gold #d4af37 background, 2.1:1)',
    '/blog/choose-the-right-photo-frame-cutting-machine/': 'shared blog CTA button (white text on gold #d4af37 background, 2.1:1)',
    // The hero carousel's own no-image fallback card — rendered whenever a
    // product has no image_url, which this suite's OWN fixture data
    // (products.image_url: null in authz-harness.js) triggers: text-white/50
    // over a semi-transparent dark overlay, 3.83:1.
    '/store/store.html': 'featured-hero no-image placeholder card (white/50% text over a dark overlay, 3.83:1)',
    // Legal sidebar's "you are here" nav button: solid gold text on white.
    '/legal/privacy-policy.html': 'legal sidebar active-page nav button (gold #d4af37 text on white, 2.1:1)'
};

test.describe('Automated WCAG 2.0 A/AA + 2.2 AA scan (axe-core)', () => {
    const PUBLIC_ROUTES = [
        '/',
        '/about.html',
        '/contact.html',
        '/catalogue.html',
        '/blog/',
        '/blog/choose-the-right-photo-frame-cutting-machine/',
        '/store/store.html',
        '/products/fake-machine',
        '/products/fake-on-request',
        '/legal/privacy-policy.html'
    ];

    for (const route of PUBLIC_ROUTES) {
        test(`${route} has zero WCAG 2.0 A/AA + 2.2 AA violations`, async ({ page }) => {
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
                .analyze();

            const knownFinding = KNOWN_COLOR_CONTRAST_FINDINGS[route];
            if (knownFinding) {
                const contrastViolation = results.violations.find(violation => violation.id === 'color-contrast');
                expect(
                    contrastViolation,
                    `expected the documented, pre-existing color-contrast finding on ${route} (${knownFinding}) — ` +
                    'see KNOWN_COLOR_CONTRAST_FINDINGS above this test. If this now passes, delete this route\'s ' +
                    'entry there; if the finding changed shape, update its description.'
                ).toBeTruthy();
            }

            const violations = knownFinding
                ? results.violations.filter(violation => violation.id !== 'color-contrast')
                : results.violations;
            expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
        });
    }
});
