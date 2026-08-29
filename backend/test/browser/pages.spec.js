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

test('Map embeds render directly without a consent prompt', async ({ page }) => {
    for (const route of ['/', '/catalogue.html', '/store/store.html', '/legal/privacy-policy.html']) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });

        const map = page.locator('[data-map-embed]');
        await expect(map).toHaveCount(1);
        await expect(map).toHaveAttribute('src', /^https:\/\/maps\.google\.com\/maps\?q=/);
        await expect(page.locator('[data-map-load]')).toHaveCount(0);
    }
});

test('Landing hero keeps every Machinery product in the mobile gallery flow', async ({ page }) => {
    const image = colour => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23${colour}'/%3E%3C/svg%3E`;
    const products = [
        {
            id: 1, name: 'Main Machinery One', category_id: 10, category_name: 'Machinery',
            images: [
                { slot: 1, is_main: true, url: image('d4af37') },
                { slot: 2, is_main: false, url: image('ff0000') }
            ]
        },
        {
            id: 2, name: 'Nested Machinery Two', category_id: 12, category_name: 'Underpinners',
            images: [{ slot: 1, is_main: true, url: image('f1f5f9') }]
        },
        {
            id: 3, name: 'Not Machinery', category_id: 11, category_name: 'Mouldings',
            images: [{ slot: 1, is_main: true, url: image('00ff00') }]
        },
        {
            id: 4, name: 'Legacy Machinery', category_id: 10, category_name: 'Machinery',
            images: [{ slot: 1, is_main: false, url: image('ff0000') }],
            image_url: image('0000ff')
        }
    ];
    const categories = [
        { id: 10, name: 'Machinery', url_slug: 'machinery', parent_id: null },
        { id: 12, name: 'Underpinners', url_slug: 'underpinners', parent_id: 10 },
        { id: 11, name: 'Mouldings', url_slug: 'mouldings', parent_id: null }
    ];

    await page.route('**/api/products/public', route => route.fulfill({ json: products }));
    await page.route('**/api/categories/public', route => route.fulfill({ json: categories }));
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const hero = page.locator('[data-machinery-hero]');
    const gallery = hero.locator('[data-machinery-hero-media]');
    const images = gallery.locator('[data-machinery-hero-image]');
    await expect(hero).toHaveCSS('background-color', 'rgb(18, 23, 15)');
    await expect(gallery).toBeVisible();
    await expect(images).toHaveCount(3);
    const slideIds = await gallery.locator('[data-machinery-hero-slide]')
        .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-product-id')).sort());
    expect(slideIds).toEqual(['1', '2', '4']);

    const actionBox = await hero.locator('a').last().boundingBox();
    const galleryBox = await gallery.boundingBox();
    expect(actionBox && galleryBox && galleryBox.y + galleryBox.height < actionBox.y).toBeTruthy();

    const sources = await images.evaluateAll(nodes => nodes.map(node => node.src));
    expect(sources.some(source => source.includes('ff0000'))).toBeFalsy();
    expect(sources.some(source => source.includes('00ff00'))).toBeFalsy();
    expect(sources.some(source => source.includes('0000ff'))).toBeTruthy();

    const active = page.locator('[data-machinery-hero-image][data-active="true"]');
    const firstSource = await active.getAttribute('src');
    await expect.poll(() => active.getAttribute('src'), { timeout: 4000 }).not.toBe(firstSource);
});

test('Store featured slideshow keeps its carousel and wraps the image on mobile', async ({ page }) => {
    const image = colour => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23${colour}'/%3E%3C/svg%3E`;
    const products = [
        { id: 1, name: 'Featured One', is_featured: true, featured_description: 'First featured machine.', image_url: image('d4af37') },
        { id: 2, name: 'Featured Two', is_featured: true, featured_description: 'Second featured machine.', image_url: image('f1f5f9') },
        { id: 3, name: 'Not Featured', is_featured: false, image_url: image('00ff00') }
    ];

    await page.route('**/api/products/public', route => route.fulfill({ json: products }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });

    const hero = page.locator('#featured-hero');
    await expect(hero).toHaveAttribute('aria-roledescription', 'carousel');
    await expect(hero.locator('[data-machinery-hero]')).toHaveCount(0);
    await expect(hero.locator('[data-hero-track] article')).toHaveCount(4); // two real slides + two edge clones
    await expect(hero.locator('[data-hero-track] img')).toHaveCount(4);

    const slideIds = await hero.locator('[data-hero-track] article h2').allTextContents();
    expect(slideIds).toEqual(['Featured Two', 'Featured One', 'Featured Two', 'Featured One']);

    const layout = await hero.locator('[data-hero-track] article').nth(1).locator('div.relative.z-10').getAttribute('class');
    expect(layout).toContain('flex-wrap');
    const mediaClass = await hero.locator('[data-hero-track] article').nth(1).locator('div.relative.z-10 > div').nth(0).getAttribute('class');
    expect(mediaClass).toContain('w-full');
    expect(mediaClass).not.toContain('hidden');
    const mediaBox = await hero.locator('[data-hero-track] article').nth(1).locator('div.relative.z-10 > div').nth(0).boundingBox();
    const detailsBox = await hero.locator('[data-hero-track] article').nth(1).locator('div.relative.z-10 > div').nth(1).boundingBox();
    expect(mediaBox && detailsBox && mediaBox.y < detailsBox.y).toBeTruthy();
    const ctaBox = await hero.locator('[data-hero-track] article').nth(1).locator('[data-hero-cta]').boundingBox();
    const heroBox = await hero.boundingBox();
    expect(ctaBox && heroBox && ctaBox.y + ctaBox.height <= heroBox.y + heroBox.height - 16).toBeTruthy();
    expect(await hero.locator('[data-hero-next]')).toBeVisible();
});

test('Landing navbar crossfades from the light AVIF logo to the current solid-header logo', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const lightLogo = page.locator('.navbar-logo-image--transparent');
    const solidLogo = page.locator('.navbar-logo-image--solid');
    await expect(lightLogo).toHaveAttribute('src', /primary-bgless-light\.avif$/);
    await expect(lightLogo).toHaveCSS('opacity', '1');
    await expect(solidLogo).toHaveCSS('opacity', '0');
    await expect(lightLogo).toHaveCSS('transition-duration', '0.9s');

    await page.evaluate(() => window.scrollTo(0, 120));
    await expect.poll(() => page.locator('header').getAttribute('class')).toContain('bg-white');
    await expect(lightLogo).toHaveCSS('opacity', '0');
    await expect(solidLogo).toHaveCSS('opacity', '1');
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

const ONLINE_SUMMARY = {
    lines: [{ product_id: 1, product_name: 'Fake Machine', unit_price: 1000, quantity: 2, line_total: 2000 }],
    blocked: [],
    totals: {
        subtotal: 2000, shipping: 0, tax: 360, total: 2360, gst_rate: 0.18,
        shipping_due_on_delivery: false, shipping_is_free: true, shipping_free_above: 50000
    },
    payments_enabled: true,
    payment_methods: ['Cash on Delivery']
};

async function fillOnlineCheckout(page) {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => sessionStorage.setItem('srk_cart', JSON.stringify({
        v: 1,
        items: [{ id: '1', name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 2 }]
    })));
    await page.goto('/store/checkout.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#checkout-form')).toBeVisible();

    for (const [selector, value] of [
        ['#checkout-name', 'Payment Buyer'], ['#checkout-phone', '9000000044'],
        ['#checkout-email', 'payment@example.test'], ['#checkout-address', '44 Payment Street'],
        ['#checkout-city', 'Gohana'], ['#checkout-state', 'Haryana'], ['#checkout-postal', '131301']
    ]) {
        await page.locator(selector).evaluate((field, next) => {
            field.removeAttribute('readonly');
            field.value = next;
            field.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
    }
}

test('Online payment runs in a new tab and a failed attempt restores the unchanged checkout', async ({ page }) => {
    let checkoutCalls = 0;
    let cancellationCalls = 0;
    let cancellationBody = null;
    await page.route('**/api/checkout/summary', route => route.fulfill({ json: ONLINE_SUMMARY }));
    await page.route('**/api/checkout', route => {
        checkoutCalls += 1;
        return route.fulfill({
            status: 201,
            json: {
                reference: 'ORD-2026-1077', order_id: 77, order_access_token: 'guest-token', customer: null,
                totals: ONLINE_SUMMARY.totals,
                payment: { key_id: 'rzp_test_browser', gateway_order_id: 'order_browser_77', amount_paise: 236000, currency: 'INR' }
            }
        });
    });
    await page.route('**/api/orders/77/cancel', route => {
        cancellationCalls += 1;
        cancellationBody = route.request().postDataJSON();
        return route.fulfill({ status: 200, json: { cancelled: true, discarded: true } });
    });
    await page.context().route('https://checkout.razorpay.com/v1/checkout.js', route => route.fulfill({
        contentType: 'application/javascript',
        body: `window.Razorpay = function (options) {
            this.handlers = {};
            this.on = (name, callback) => { this.handlers[name] = callback; };
            this.open = () => setTimeout(() => this.handlers['payment.failed']({ error: { description: 'Card was declined.' } }), 20);
        };`
    }));

    await fillOnlineCheckout(page);
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#checkout-submit').click();
    const paymentTab = await popupPromise;

    await expect.poll(() => paymentTab.isClosed()).toBe(true);
    await expect(page.locator('#checkout-form')).toBeVisible();
    await expect(page.locator('#checkout-name')).toHaveValue('Payment Buyer');
    await expect(page.locator('#checkout-address')).toHaveValue('44 Payment Street');
    await expect(page.getByRole('alertdialog')).toContainText('Payment unsuccessful');
    await expect(page.getByRole('alertdialog')).toContainText('checkout details are unchanged');
    expect(checkoutCalls).toBe(1);
    expect(cancellationCalls).toBe(1);
    expect(cancellationBody).toEqual({ reason: 'payment_failed' });
});

test('A successful payment closes only its tab and confirms the order on checkout', async ({ page }) => {
    await page.route('**/api/checkout/summary', route => route.fulfill({ json: ONLINE_SUMMARY }));
    await page.route('**/api/checkout', route => route.fulfill({
        status: 201,
        json: {
            reference: 'ORD-2026-1078', order_id: 78, order_access_token: 'guest-token', customer: null,
            totals: ONLINE_SUMMARY.totals,
            payment: { key_id: 'rzp_test_browser', gateway_order_id: 'order_browser_78', amount_paise: 236000, currency: 'INR' }
        }
    }));
    await page.route('**/api/payments/verify', route => route.fulfill({
        status: 200,
        json: { paid: true, reference: 'ORD-2026-1078', order_id: 78 }
    }));
    await page.context().route('https://checkout.razorpay.com/v1/checkout.js', route => route.fulfill({
        contentType: 'application/javascript',
        body: `window.Razorpay = function (options) {
            this.on = () => {};
            this.open = () => setTimeout(() => options.handler({
                razorpay_order_id: 'order_browser_78',
                razorpay_payment_id: 'pay_browser_78',
                razorpay_signature: 'browser-signature'
            }), 20);
        };`
    }));

    await fillOnlineCheckout(page);
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#checkout-submit').click();
    const paymentTab = await popupPromise;

    await expect.poll(() => paymentTab.isClosed()).toBe(true);
    await expect(page.locator('#checkout-root')).toContainText('ORD-2026-1078');
    await expect(page.getByRole('alertdialog')).toContainText('Payment successful');
    await expect.poll(() => page.evaluate(() => window.storeCart.items().length)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem('srk_checkout_draft'))).toBeNull();
});

test('Store product details are reachable with Enter and Space', async ({ page }) => {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    const card = page.locator('article[data-product-id][role="button"][tabindex="0"]').first();
    await expect(card).toBeVisible();

    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#product-details')).toBeVisible();
    await page.locator('#product-details-close').click();
    await expect(page.locator('#product-details')).toHaveCount(0);

    await card.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#product-details')).toBeVisible();
});

test('Malformed encoded hashes fall back safely', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/store/store.html#%E0%A4%A', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Shop by Category' })).toBeVisible();

    await page.goto('/catalogue.html#%E0%A4%A', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.category-btn').first()).toBeVisible();
    expect(errors).toEqual([]);
});

test('Script CSP has no broad inline execution grant', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    const csp = response && response.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    const scriptDirective = csp.split(';').find(part => part.trim().startsWith('script-src')) || '';
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).toContain("'sha256-");
    expect(await page.evaluate(() => !!window.lenis)).toBe(true);
});
