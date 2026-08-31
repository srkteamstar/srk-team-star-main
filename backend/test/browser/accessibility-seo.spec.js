const { test, expect } = require('@playwright/test');
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
    await page.route('**/api/products/public', route => route.fulfill({ json: [1, 2, 3].map(id => ({ id, name: 'Featured ' + id, url_slug: 'featured-' + id, is_featured: true, category_id: 10, price: 'On request' })) }));
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
    await page.route('**/api/products/public', route => route.fulfill({ json: [1, 2, 3].map(id => ({ id, name: 'Machine ' + id, category_id: 10, category_name: 'Machinery' })) }));
    await page.goto('/');
    const control = page.getByRole('button', { name: 'Pause slideshow' });
    await control.click();
    await expect(control).toHaveText('Play slideshow');
    const active = await page.locator('[data-machinery-hero-slide][data-active="true"]').getAttribute('data-product-id');
    await page.waitForTimeout(2800);
    await expect(page.locator('[data-machinery-hero-slide][data-active="true"]')).toHaveAttribute('data-product-id', active);
    await control.click();
    await expect(control).toHaveText('Pause slideshow');
});

test('Static copy, bypass link and product discovery work without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
        const page = await context.newPage();
        for (const path of ['/about.html', '/blog/', '/contact.html', '/products/fake-machine']) {
            await page.goto('http://127.0.0.1:3457' + path);
            await expect(page.locator('h1')).toBeVisible();
            await page.keyboard.press('Tab');
            await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
            const invisible = await page.locator('.scroll-reveal').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).opacity === '0'));
            expect(invisible).toBe(false);
        }
        await page.goto('http://127.0.0.1:3457/catalogue.html');
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
