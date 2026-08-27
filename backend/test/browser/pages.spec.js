const { test, expect } = require('@playwright/test');

const pages = [
    '/', '/about.html', '/catalogue.html', '/contact.html',
    '/store/store.html', '/store/checkout.html',
    '/legal/home.html', '/legal/privacy-policy.html', '/legal/terms-of-service.html',
    '/legal/shipping-policy.html', '/legal/return-policy.html', '/legal/support-policy.html',
    '/blog/',
    '/blog/from-malik-studio-to-machine-manufacturing/',
    '/blog/choose-the-right-photo-frame-cutting-machine/',
    '/blog/efficient-cut-to-join-production-workflow/',
    '/blog/preventive-maintenance-checklist-for-framing-machines/',
    '/blog/reduce-frame-moulding-waste/',
    '/blog/manual-vs-pneumatic-underpinners/',
    '/blog/scale-a-professional-frame-making-business/',
    '/blog/supporting-frame-makers-across-borders/'
];

const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 }
];

for (const path of pages) {
    test(`${path} has a heading, skip target, and no page overflow`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
            expect(response && response.ok(), `${path} should return a successful document`).toBeTruthy();

            await expect.poll(() => page.locator('h1').count()).toBe(1);
            const skip = page.locator('a.srk-skip-link');
            await expect(skip).toHaveCount(1);
            const href = await skip.getAttribute('href');
            expect(href).toMatch(/^#[A-Za-z][\w:.-]*$/);
            await expect(page.locator(href)).toHaveCount(1);

            await page.waitForTimeout(250);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, `${path} overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
        }

        expect(errors, `${path} raised browser errors`).toEqual([]);
    });
}

// THE HOME ROW AND THE SECTION BEHIND ITS "VIEW ALL" ANSWER ONE QUESTION.
//
// Both rows on the store home page are a truncation of the section their link
// opens — they share a `select` for exactly that reason. This is the assertion
// that keeps it true: a row product missing from the full section means the
// home page is advertising something View All does not lead to, which is what
// the four hardcoded cards this replaced were doing.
//
// The harness catalogue is two products with no flags, so the rows are seeded
// here instead — the cap and the subset rule need more than four to say
// anything.
const HOME_CATALOGUE = [
    ['Alpha Underpinner', '45000', 10, '2026-08-20', { is_new_arrival: true }],
    ['Bravo Mitre Saw', '128000', 10, '2026-08-18', { is_best_seller: true }],
    ['Charlie Underpinner', '18500', 10, '2026-06-02', { is_best_seller: true }],
    ['Delta Board Cutter', 'On request', 10, '2026-05-11', {}],
    ['Echo Core Box', '3200', 11, '2026-08-22', {}],
    ['Foxtrot Ornate', '6400', 11, '2026-08-19', { is_best_seller: true }],
    ['Golf Veneer', '4100', 11, '2026-07-04', { is_best_seller: true }],
    ['Hotel Slim Profile', '2900', 11, '2026-03-01', { is_best_seller: true }],
    ['India D-Rings', '850', 11, '2026-01-09', {}]
].map(([name, price, category_id, day, flags], i) => Object.assign({
    id: i + 1, name, url_slug: 'home-' + (i + 1), description: 'd', featured_description: null,
    price, category_id, asset_folder: name, is_active: true,
    is_featured: false, is_best_seller: false, is_new_arrival: false,
    image_url: null, images: [],
    created_at: day + 'T00:00:00Z', updated_at: day + 'T00:00:00Z'
}, flags));

const names = (page, selector) => page.locator(selector + ' article[data-product-id] h3').allTextContents();

for (const row of [
    { host: 'new-arrivals-preview', policy: 'new-arrivals', section: 'dynamic-new-arrivals-wrapper', heading: 'New Arrivals' },
    { host: 'best-sellers-preview', policy: 'best-sellers', section: 'dynamic-bestsellers-wrapper', heading: 'Best Sellers' }
]) {
    test(`Store home ${row.heading} row shows four real products, and View All shows the rest`, async ({ page }) => {
        await page.route('**/api/products/public', route => route.fulfill({ json: HOME_CATALOGUE }));
        await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });

        const host = '#' + row.host;
        await expect(page.locator(host + ' article[data-product-id]')).toHaveCount(4);

        // The cards are the catalogue's, not markup typed into store.html.
        const preview = await names(page, host);
        preview.forEach(name => expect(HOME_CATALOGUE.some(p => p.name === name)).toBeTruthy());

        await page.locator(host + ' a[href="#' + row.policy + '"]').click();
        await expect(page.locator('#' + row.section)).toBeVisible();

        const full = await names(page, '#' + row.section);
        expect(full.length).toBeGreaterThanOrEqual(preview.length);
        preview.forEach(name => expect(full, `${name} is on the home row but not in ${row.heading}`).toContain(name));
    });
}

// A heading over an empty row reads as broken, so the block leaves rather than
// standing there empty. The harness catalogue has nothing ticked as a best
// seller, which is the real unflagged case and needs no fixture.
test('Store home drops the Best Sellers row when nothing is flagged', async ({ page }) => {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#new-arrivals-preview')).toBeVisible();
    await expect(page.locator('#best-sellers-preview')).toHaveCount(0);
});

test('Blog category filtering hides non-matching authored layouts', async ({ page }) => {
    await page.goto('/blog/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-blog-filter="machinery"]').click();

    await expect(page.locator('[data-blog-feature-section]')).toBeHidden();
    await expect(page.locator('[data-blog-card]:visible')).toHaveCount(2);
    await expect(page.locator('#blog-filter-status')).toHaveText('2 articles shown.');
    await expect(page).toHaveURL(/category=machinery/);
});

test('Checkout keeps a guest draft and payment choice through reload', async ({ page }) => {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => sessionStorage.setItem('srk_cart', JSON.stringify({
        v: 1,
        items: [{ id: '1', name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 2 }]
    })));
    await page.goto('/store/checkout.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#checkout-form')).toBeVisible();

    const setField = async (selector, value) => page.locator(selector).evaluate((field, next) => {
        field.removeAttribute('readonly');
        field.value = next;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);

    await setField('#checkout-name', 'Draft Buyer');
    await setField('#checkout-phone', '9000000042');
    await setField('#checkout-email', 'draft@example.test');
    await setField('#checkout-address', '42 Draft Street');
    await setField('#checkout-city', 'Gohana');
    await setField('#checkout-state', 'Haryana');
    await setField('#checkout-postal', '131301');
    await page.locator('[data-payment-method="Cash on Delivery"]').click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#checkout-form')).toBeVisible();
    await expect(page.locator('#checkout-name')).toHaveValue('Draft Buyer');
    await expect(page.locator('#checkout-address')).toHaveValue('42 Draft Street');
    await expect(page.locator('[data-payment-method="Cash on Delivery"]')).toHaveAttribute('aria-pressed', 'true');
});
