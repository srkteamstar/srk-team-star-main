const { test, expect } = require('@playwright/test');
const assets = require('../../../tools/web-assets-manifest.json');
const images = require('../../../tools/local-image-manifest.json');
const { routeCatalogue } = require('./catalogue-route');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#d4af37"/></svg>';
async function catalogue(page) {
    await page.route('**/api/categories/public', route => route.fulfill({ json: [{ id: 10, name: 'Machinery', url_slug: 'machinery' }] }));
    await routeCatalogue(page, [1, 2, 3].map(id => ({
        id, name: 'Machine ' + id, category_id: 10, category_name: 'Machinery', image_url: '/perf-fixture/hero-' + id + '.svg'
    })));
}

test('Hero requests only the first image until it is ready, then one slide ahead', async ({ page }) => {
    await catalogue(page);
    const requests = [];
    let releaseFirst;
    const firstReady = new Promise(resolve => { releaseFirst = resolve; });
    await page.route('**/perf-fixture/*.svg', async route => {
        const id = Number(route.request().url().match(/hero-(\d)/)[1]);
        requests.push(id);
        if (id === 1) await firstReady;
        await route.fulfill({ contentType: 'image/svg+xml', body: svg });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const slides = page.locator('[data-machinery-hero-image]');
    await expect(slides).toHaveCount(3);
    await expect.poll(() => requests).toEqual([1]);
    await expect(slides.nth(0)).toHaveAttribute('fetchpriority', 'high');
    await expect(slides.nth(0)).toHaveAttribute('loading', 'eager');
    await expect(slides.nth(1)).not.toHaveAttribute('src');
    await expect(slides.nth(2)).not.toHaveAttribute('src');
    releaseFirst();
    await expect.poll(() => requests).toEqual([1, 2]);
    await expect(slides.nth(1)).toHaveAttribute('fetchpriority', 'low');
    await expect(slides.nth(2)).not.toHaveAttribute('src');
    await expect.poll(() => requests, { timeout: 6000 }).toEqual([1, 2, 3]);
});

test('Hero holds the visible slide while its successor is slow', async ({ page }) => {
    await catalogue(page);
    let releaseSecond;
    const secondReady = new Promise(resolve => { releaseSecond = resolve; });
    await page.route('**/perf-fixture/*.svg', async route => {
        if (route.request().url().includes('hero-2')) await secondReady;
        await route.fulfill({ contentType: 'image/svg+xml', body: svg });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const first = page.locator('[data-machinery-hero-image]').nth(0);
    await expect(first).toHaveAttribute('data-active', 'true');
    await page.waitForTimeout(3000);
    await expect(first).toHaveAttribute('data-active', 'true');
    releaseSecond();
    await expect(page.locator('[data-machinery-hero-image]').nth(1)).toHaveAttribute('data-active', 'true', { timeout: 4000 });
});

test('Reduced motion downloads only the first hero image', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await catalogue(page);
    const requests = [];
    await page.route('**/perf-fixture/*.svg', route => {
        requests.push(route.request().url());
        return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requests.length).toBe(1);
    await page.waitForTimeout(900);
    expect(requests).toHaveLength(1);
    await expect(page.locator('[data-machinery-hero-image]').nth(1)).not.toHaveAttribute('src');
});

test('Hero recovers from an image failure without stopping the gallery', async ({ page }) => {
    await catalogue(page);
    await page.route('**/perf-fixture/*.svg', route => route.request().url().includes('hero-1')
        ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: svg }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-machinery-hero-slide][data-product-id="1"]')).toHaveAttribute('role', 'img');
    await expect(page.locator('[data-machinery-hero-slide][data-product-id="2"]')).toHaveAttribute('data-active', 'true', { timeout: 6000 });
});

test('Home copy remains visible without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
        const page = await context.newPage();
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        for (const id of ['hero-heading', 'hero-subtext', 'hero-ctas']) {
            await expect(page.locator('#' + id)).toHaveCSS('opacity', '1');
            await expect(page.locator('#' + id)).toBeVisible();
        }
    } finally { await context.close(); }
});

test('Versioned assets are immutable while stable scripts and documents revalidate', async ({ request }) => {
    const optimized = Object.values(images)[0].variants[0].url;
    for (const url of [assets['/assets/vendor/tailwind.build.css'], assets['/js/platform/scroll-lock-module.js'], optimized]) {
        const response = await request.get(url);
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    }
    for (const url of ['/', '/js/platform/scroll-lock-module.js', '/assets/vendor/tailwind.build.css']) {
        const response = await request.get(url);
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toBe('no-cache');
    }
});

test('Home has accessible enquiry fields, a named WhatsApp link and deferred scripts', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Chat with SRK Team Star on WhatsApp' })).toHaveCount(1);
    for (const name of ['Name', 'Company', 'Email', 'Phone Number', 'Your Message']) {
        await expect(page.getByRole('textbox', { name, exact: true })).toHaveCount(1);
    }
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /frame/);
    await expect(page.locator('script[src]:not([defer])')).toHaveCount(0);
    await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(2);
    const src = await page.locator('script[src]').last().getAttribute('src');
    expect(src).toContain('view-state-restore-module.js');
});

test('Blog images have local responsive sources, reserved dimensions and lazy loading', async ({ page }) => {
    await page.goto('/blog/', { waitUntil: 'domcontentloaded' });
    const image = page.locator('img[data-local-image="/assets/hero-image.png"]').first();
    await expect(image).toHaveAttribute('src', /^\/assets\/optimized\/.*\.webp$/);
    await expect(image).toHaveAttribute('srcset', /480w.*800w.*1280w.*1600w/);
    await expect(image).toHaveAttribute('width', '1672');
    await expect(image).toHaveAttribute('height', '941');
    await expect(image).toHaveAttribute('loading', 'lazy');
});
