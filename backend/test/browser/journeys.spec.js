/*
 * journeys.spec.js — what a customer actually does, end to end
 * ============================================================================
 *
 * pages.spec.js beside this is a SMOKE suite: every page loads, has one <h1>,
 * has a working skip link, does not overflow at four widths, and raises no
 * browser errors. That catches a page that is broken. It cannot catch a page
 * that renders perfectly and does the wrong thing.
 *
 * These are the journeys. Each one crosses at least one seam — a module
 * boundary, a page navigation, a storage key, or the server — because that is
 * where this codebase's real failures have been: a cart handed to a form that
 * could not read it, a draft that blanked the account it was meant to
 * complete, a link whose slug had drifted from the database.
 *
 * They run against the SAME in-memory harness the API suites use
 * (authz-harness.js), so they touch no live data, and they use the same
 * catalogue fixtures every other test does.
 *
 * WHY THESE PARTICULAR ONES
 * ---------------------------------------------------------------------------
 * Every test here is a behaviour somebody has already got wrong once, or one
 * an audit asked to be made true. None of them is a happy path chosen because
 * it was easy to write.
 */

const { test, expect } = require('@playwright/test');

// The harness fixtures: id 1 is an active, priced product; the "On request"
// row is the one checkout must refuse.
const PRICED_PRODUCT_ID = '1';

/** Put a cart in place without clicking through the store to build one. */
async function seedGuestCart(page, items) {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((lines) => {
        sessionStorage.setItem('srk_cart', JSON.stringify({ v: 1, items: lines }));
    }, items);
}

const CART_LINE = {
    id: PRICED_PRODUCT_ID,
    name: 'Fake Machine',
    category_name: 'Machinery',
    price: '1000',
    image_url: '',
    quantity: 2
};

// ---------------------------------------------------------------------------
// 1. THE STYLESHEET IS REAL
// ---------------------------------------------------------------------------
// Tailwind is compiled ahead of time now instead of in the browser, which
// bought a 400KB script off every page and cost a build step. The failure mode
// that introduces is specific and silent: someone adds a class, forgets
// `npm run build:css`, and that ONE class does nothing while the page still
// looks broadly right.
//
// So this asserts a computed style rather than the presence of a <link>. A
// missing, stale or empty stylesheet fails it; a served 404 fails it too.
test('the compiled stylesheet is actually applied', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const sheet = await page.evaluate(() =>
        [...document.styleSheets].some(s => (s.href || '').includes('tailwind.build.css')));
    expect(sheet, 'the compiled stylesheet should be loaded, not 404').toBe(true);

    // .bg-[#d4af37] is the site's gold and appears on every primary button.
    const probe = await page.evaluate(() => {
        const el = document.createElement('div');
        el.className = 'bg-[#d4af37] hidden md:flex';
        document.body.appendChild(el);
        const style = getComputedStyle(el);
        const result = { background: style.backgroundColor, display: style.display };
        el.remove();
        return result;
    });

    expect(probe.background, 'an arbitrary-value class should resolve').toBe('rgb(212, 175, 55)');
    expect(probe.display, "the md: breakpoint should apply at this viewport").toBe("flex");
});

// ---------------------------------------------------------------------------
// 2. BUY NOW GOES TO CHECKOUT
// ---------------------------------------------------------------------------
// It used to add the item and open the cart drawer, which is the quiet-add
// behaviour of the bag icon beside it — two controls doing the same thing,
// one of them labelled as if it did something else. The button now says what
// it does, and this is what stops it drifting back.
test('Buy Now adds the product and continues to checkout', async ({ page }) => {
    await page.goto('/store/store.html#all-products', { waitUntil: 'domcontentloaded' });

    const card = page.locator('article[data-product-id]').first();
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.locator('.buy-now-btn').click();

    await expect(page).toHaveURL(/\/store\/checkout\.html$/, { timeout: 15000 });

    // Arrived with the item, not with an empty basket.
    await expect(page.locator('#checkout-form')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. THE BAG ICON DOES NOT
// ---------------------------------------------------------------------------
// The other half of the same contract. If both controls navigated, the quiet
// add would be gone and browsing would be interrupted by every add.
test('the bag icon adds quietly and stays on the page', async ({ page }) => {
    await page.goto('/store/store.html#all-products', { waitUntil: 'domcontentloaded' });

    const card = page.locator('article[data-product-id]').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('.cart-icon-btn').click();

    await expect(page).toHaveURL(/\/store\/store\.html/);
    await expect.poll(async () => page.evaluate(() => window.storeCart.items().length)).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 4. MORE PRODUCTS OPENS THE PRODUCT IT NAMES
// ---------------------------------------------------------------------------
// This rail used to be five typed sample cards with no product ids. It looked
// like the live catalogue but could not open anything. The rail now reuses the
// catalogue rows, and this proves the id survives all the way through the
// delegated card click into a repaint of the existing details overlay.
test('a More Products card opens that product in the details overlay', async ({ page }) => {
    await page.goto('/store/store.html#all-products', { waitUntil: 'domcontentloaded' });

    const firstCard = page.locator('article[data-product-id]').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });
    await firstCard.click();

    const overlay = page.locator('#product-details');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(overlay.locator('#product-details-title')).toHaveText('Fake Machine');

    const suggestion = overlay.locator('#product-details-rail article[data-product-id]').first();
    await expect(suggestion).toBeVisible({ timeout: 15000 });
    await expect(suggestion.locator('h3')).toHaveText('Fake On Request');
    await suggestion.click();

    await expect(overlay.locator('#product-details-title')).toHaveText('Fake On Request');
    await expect(page.locator('#product-details')).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// 5. A GUEST CAN PLACE A CASH ON DELIVERY ORDER
// ---------------------------------------------------------------------------
// The whole commercial path in one test: cart -> priced summary -> contact and
// address -> an offline instrument -> a placed order with a reference. It
// crosses the server twice (summary, then checkout) and is the journey that
// pays for the site.
test('a guest can check out with Cash on Delivery and gets a reference', async ({ page }) => {
    await seedGuestCart(page, [CART_LINE]);
    await page.goto('/store/checkout.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#checkout-form')).toBeVisible({ timeout: 15000 });

    const fill = async (selector, value) => page.locator(selector).evaluate((field, next) => {
        field.removeAttribute('readonly');
        field.value = next;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);

    await fill('#checkout-name', 'Journey Buyer');
    await fill('#checkout-phone', '9000000077');
    await fill('#checkout-email', 'journey@example.test');
    await expect(page.locator('#checkout-password')).toHaveCount(0);
    await expect(page.locator('#checkout-form')).toContainText('No account will be created.');
    await fill('#checkout-address', '7 Journey Road');
    await fill('#checkout-city', 'Gohana');
    await fill('#checkout-state', 'Haryana');
    await fill('#checkout-postal', '131301');

    // The money the customer is shown, before anything is placed.
    await expect(page.locator('#checkout-root')).toContainText('₹', { timeout: 15000 });

    await page.locator('[data-payment-method="Cash on Delivery"]').click();
    await expect(page.locator('[data-payment-method="Cash on Delivery"]'))
        .toHaveAttribute('aria-pressed', 'true');

    // #checkout-submit, which sits OUTSIDE the form and reaches it through
    // form="checkout-form" — it lives in the summary column beside the total.
    await page.locator('#checkout-submit').click();

    // ORD-<year>-<order number>. A confirmation without one is a screen that
    // says "placed" and gives the customer nothing to quote when they ring up.
    await expect(page.locator('#checkout-root')).toContainText(/ORD-\d{4}-\d+/, { timeout: 20000 });

    // The confirmation now opens the formal, token-protected guest record instead of
    // printing the cramped success notice itself.
    await expect(page.locator('#checkout-invoice')).toHaveText(/View \/ Print Invoice/);
    await page.locator('#checkout-invoice').click();

    const invoice = page.locator('.purchase-invoice');
    await expect(invoice).toBeVisible({ timeout: 15000 });
    await expect(invoice).toContainText('Purchase Invoice');
    await expect(invoice).toContainText('Fake Machine');
    await expect(invoice).toContainText('Journey Buyer');
    await expect(invoice).toContainText('06DOCPR1264G1Z0');
    await expect(invoice.locator('.invoice-badge')).toHaveText('Pending');
    await expect(invoice.locator('.invoice-totals')).toContainText('GST');
    await expect(invoice.locator('.invoice-totals')).not.toContainText('CGST');
    await expect(invoice.locator('.invoice-totals')).not.toContainText('SGST');
    await expect(invoice).toContainText('Cash on Delivery');
    await expect.poll(() => page.locator('#invoice-print span').evaluate(node => getComputedStyle(node).color))
        .toBe('rgb(255, 255, 255)');

    // Print media removes all app chrome but retains the A4 invoice and repeatable
    // table header. The native print dialog is stubbed so the journey remains
    // deterministic in CI.
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('#invoice-print').click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#order-invoice-overlay > header')).toBeHidden();
    await expect(page.locator('.invoice-toolbar')).toBeHidden();
    await expect(invoice).toBeVisible();

    // A cart that outlives the order it became is the one wrong answer.
    await expect.poll(async () => page.evaluate(() => window.storeCart.items().length)).toBe(0);
});

test('My Orders opens the same printable invoice without accepting an order id from the page', async ({ page }) => {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    const signedIn = await page.evaluate(async () => {
        const result = await window.customerSession.signIn({
            identifier: 'a@example.test', password: 'correct-horse-42'
        });
        return result.ok;
    });
    expect(signedIn).toBe(true);

    await page.evaluate(() => {
        const panel = document.createElement('div');
        panel.id = 'invoice-history-test-panel';
        document.body.appendChild(panel);
        return window.myOrders.renderPanel(panel);
    });

    await page.locator('#invoice-history-test-panel .orders-toggle').first().click();
    const historyButton = page.locator('#invoice-history-test-panel [data-view-invoice="900"]');
    await expect(historyButton).toBeVisible({ timeout: 15000 });
    await historyButton.click();

    const invoice = page.locator('.purchase-invoice');
    await expect(invoice).toBeVisible({ timeout: 15000 });
    await expect(invoice).toContainText('INV-20260201-000900');
    await expect(invoice).toContainText('ORD-2026-900');
    await expect(invoice.locator('.invoice-badge')).toHaveText('Pending');
});

test('a long invoice prints across multiple A4 pages with repeating table headings', async ({ page }) => {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        await window.customerSession.signIn({
            identifier: 'a@example.test', password: 'correct-horse-42'
        });
        window.orderInvoice.open(900);
    });
    await page.locator('.purchase-invoice').waitFor({ state: 'visible', timeout: 15000 });

    // The fixture has one real frozen line. Repeat that rendered row only to
    // exercise the print engine with a large order; no API or calculation is
    // replaced, and the original invoice remains the source of the markup.
    await page.locator('.invoice-table tbody').evaluate(body => {
        const row = body.querySelector('tr');
        for (let index = 2; index <= 55; index += 1) {
            const copy = row.cloneNode(true);
            copy.children[0].textContent = String(index);
            body.appendChild(copy);
        }
    });
    await page.emulateMedia({ media: 'print' });

    const printRules = await page.evaluate(() => ({
        head: getComputedStyle(document.querySelector('.invoice-table thead')).display,
        rowBreak: getComputedStyle(document.querySelector('.invoice-table tbody tr')).breakInside,
        toolbar: getComputedStyle(document.querySelector('.invoice-toolbar')).display
    }));
    expect(printRules.head).toBe('table-header-group');
    expect(['avoid', 'avoid-page']).toContain(printRules.rowBreak);
    expect(printRules.toolbar).toBe('none');

    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pageObjects = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    const pageTreeCounts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)]
        .map(match => Number(match[1]));
    expect(Math.max(pageObjects, ...pageTreeCounts)).toBeGreaterThan(1);
});

// ---------------------------------------------------------------------------
// 5. THE CART SURVIVES A NAVIGATION INTO THE QUOTE FORM, QUANTITIES INCLUDED
// ---------------------------------------------------------------------------
// The handoff used to ride on a window global, which does not survive the
// navigation from checkout.html to store.html — so a customer told "send it as
// a quote request" arrived at an empty form with every product and quantity
// discarded. sessionStorage carries it now, and is consumed on read.
test('a basket handed to the quote form arrives with its quantities', async ({ page }) => {
    await seedGuestCart(page, [CART_LINE]);

    await page.evaluate(() => {
        window.storeOverlay.pendingQuote.put([{ product_id: '1', quantity: 4 }]);
    });

    // A RELOAD, not a fragment change. request-quote-module.js reads the hash
    // once at DOMContentLoaded, and navigating from store.html to
    // store.html#quote is a same-document fragment navigation that fires no
    // such event — the overlay would never open, and the test would be
    // asserting against a page that was never asked to show the form.
    await page.goto('/store/store.html#quote');
    await page.reload({ waitUntil: 'domcontentloaded' });

    const quantity = page.locator('.quote-quantity').first();
    await expect(quantity).toBeVisible({ timeout: 15000 });
    await expect(quantity).toHaveValue('4');

    // The browser sends only id + quantity; the visible amount arrives from the
    // server calculator and includes GST. Changing the quantity is debounced,
    // and must not repaint unrelated business fields.
    await expect(page.locator('#quote-pricing-summary')).toContainText('₹ 4,000', { timeout: 15000 });
    await page.locator('#quote-business-name').fill('Draft Business');
    await quantity.fill('2');
    await expect(page.locator('#quote-pricing-summary')).toContainText('₹ 2,360', { timeout: 15000 });
    await expect(page.locator('#quote-business-name')).toHaveValue('Draft Business');

    // Consumed: opening the form again offers a blank request, not the same
    // basket a second time.
    const leftOver = await page.evaluate(() => sessionStorage.getItem('srk_pending_quote'));
    expect(leftOver).toBeNull();
});

test('a submitted quote request produces a clean printable server snapshot', async ({ page }) => {
    await seedGuestCart(page, [CART_LINE]);
    await page.evaluate(() => window.storeOverlay.pendingQuote.put([{ product_id: '1', quantity: 1 }]));
    await page.goto('/store/store.html#quote');
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('#quote-form')).toBeVisible({ timeout: 15000 });
    await page.locator('#quote-business-name').fill('Printable Business');
    await page.locator('#quote-contact-name').fill('Buyer Person');
    await page.locator('#quote-email').fill('print@example.test');
    await page.locator('#quote-business-address').fill('Gohana, Haryana 131301');
    await expect(page.locator('#quote-pricing-summary')).toContainText('₹ 1,180', { timeout: 15000 });

    await page.locator('#quote-submit').click();

    const document = page.locator('.quote-print-document');
    await expect(document).toBeVisible({ timeout: 15000 });
    await expect(document).toContainText(/PI-\d{4}-\d+/);
    await expect(document).toContainText('REQUEST ACKNOWLEDGEMENT');
    await expect(document).toContainText('Fake Machine');
    await expect(document).toContainText('₹ 1,180');
    await expect(document).toContainText('not an accepted order');

    await page.locator('#quote-print').hover();
    await expect.poll(() => page.locator('#quote-print span').evaluate(node => getComputedStyle(node).color))
        .toBe('rgb(255, 255, 255)');

    // The print-only stylesheet is installed by the button itself. Stub the
    // native dialog, click the real control, and verify the screen chrome drops
    // out while the A4 document remains.
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('#quote-print').click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.quote-screen-only')).toBeHidden();
    await expect(document).toBeVisible();
});

// ---------------------------------------------------------------------------
// 6. SIGNING IN FROM CHECKOUT DOES NOT BLANK WHAT WAS TYPED
// ---------------------------------------------------------------------------
// The draft stored every field including the untouched ones, as '', and the
// prefill treated '' as an answer — so following "Sign in to fill this in"
// came back with the saved details blanked by the blanks left behind.
test('an untouched checkout field is not stored as an empty draft value', async ({ page }) => {
    await seedGuestCart(page, [CART_LINE]);
    await page.goto('/store/checkout.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#checkout-form')).toBeVisible({ timeout: 15000 });

    await page.locator('#checkout-name').evaluate((field) => {
        field.removeAttribute('readonly');
        field.value = 'Only The Name';
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('srk_checkout_draft') || '{}'));

    expect(draft.name).toBe('Only The Name');
    expect(Object.prototype.hasOwnProperty.call(draft, 'phone'),
        'an untouched field must not be stored as an empty string').toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft, 'city')).toBe(false);
    expect(await page.locator('#checkout-password').count(), 'guest checkout must not ask for a password').toBe(0);
});

// ---------------------------------------------------------------------------
// 7. THE CATALOGUE DEEP LINKS RESOLVE
// ---------------------------------------------------------------------------
// #moulding is published in the footer of every public page while the database
// spells the category `moldings`, so the link had been landing on the default
// tab. Resolution is layered now; this is the layer that matters.
test('#moulding reaches the mouldings category despite the database spelling', async ({ page }) => {
    await page.goto('/catalogue.html#moulding', { waitUntil: 'domcontentloaded' });

    const active = page.locator('.category-btn[data-selected="true"]').first();
    await expect(active).toBeVisible({ timeout: 15000 });
    await expect(active).toContainText(/mold|mould/i);
});

test('an unrecognised catalogue hash lands on the default tab rather than hanging', async ({ page }) => {
    await page.goto('/catalogue.html#not-a-category', { waitUntil: 'domcontentloaded' });

    // The page must finish loading. A hash that matched the default tab used to
    // leave it on "Loading the catalogue…" forever.
    await expect(page.locator('#category-filters .category-btn').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Loading the catalogue');
});

// ---------------------------------------------------------------------------
// 8. ONE ENQUIRY FORM, ON EVERY PAGE THAT CARRIES ONE
// ---------------------------------------------------------------------------
// Four inline copies and a fifth module became one file. This asserts the
// shared module is what is wired up, and that the form posts somewhere real
// rather than to action="#", which reloaded the page and discarded the
// enquiry.
for (const path of ['/', '/contact.html', '/catalogue.html', '/store/store.html', '/legal/home.html']) {
    test(`${path} uses the shared enquiry form`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });

        const form = page.locator('form[data-enquiry-form]');
        await expect(form).toHaveCount(1);

        // Wired by the module, not by an inline script.
        await expect(form).toHaveAttribute('data-enquiry-wired', 'true');

        // A real destination. action="#" is what this replaced.
        await expect(form).toHaveAttribute('action', '/api/submit-form');
        await expect(form).toHaveAttribute('method', 'post');

        // The fields FormData reads are named, which the policy pages relied on
        // the module to do for them.
        for (const [id, name] of Object.entries({
            'form-name': 'full_name', 'form-email': 'email', 'form-message': 'message'
        })) {
            await expect(page.locator('#' + id)).toHaveAttribute('name', name);
        }
    });
}

test('submitting an enquiry reports back through the shared status line', async ({ page }) => {
    await page.goto('/contact.html', { waitUntil: 'domcontentloaded' });

    await page.locator('#form-name').evaluate(f => { f.removeAttribute('readonly'); f.value = 'Journey Enquirer'; });
    await page.locator('#form-email').evaluate(f => { f.removeAttribute('readonly'); f.value = 'enquiry@example.test'; });
    await page.locator('#form-message').evaluate(f => { f.removeAttribute('readonly'); f.value = 'Testing the one implementation.'; });

    await page.locator('#submit-btn').click();

    // Either outcome is a pass for THIS assertion — what is being tested is
    // that the shared module reports at all. It is the silent form that was
    // the bug: five copies, three of which said nothing on some paths.
    await expect(page.locator('#form-status')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#form-status')).not.toBeEmpty();
});

// ---------------------------------------------------------------------------
// 9. THE SIX POLICY PAGES ARE ONE SHELL AND STILL SIX PAGES
// ---------------------------------------------------------------------------
// 2,412 lines of copied markup became one template plus a route. The URLs are
// the contract — they are linked from every footer on the site — so each must
// still answer on its own path, with its own title and its own policy selected.
const POLICIES = [
    ['/legal/home.html', 'home'],
    ['/legal/privacy-policy.html', 'privacy'],
    ['/legal/terms-of-service.html', 'terms'],
    ['/legal/shipping-policy.html', 'shipping'],
    ['/legal/return-policy.html', 'return'],
    ['/legal/support-policy.html', 'support']
];

for (const [path, policy] of POLICIES) {
    test(`${path} is served from the shared shell with its own identity`, async ({ page }) => {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response.ok()).toBe(true);

        await expect(page.locator('body')).toHaveAttribute('data-active-policy', policy);

        // The title comes from policy-loader.js's own map, read by the server
        // at boot rather than written down a second time.
        await expect(page).toHaveTitle(/SRK Team Star/);

        // The policy body is injected by policy-loader.js into the shell.
        await expect(page.locator('#policy-content h1')).toHaveCount(1);
    });
}

test('the legal shell template is not itself servable', async ({ request }) => {
    const response = await request.get('/backend/templates/legal-shell.html');
    expect(response.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// 10. THE CART SAYS WHAT CHECKOUT WILL DO
// ---------------------------------------------------------------------------
// The drawer once told customers that tax and delivery were "quoted
// separately" while checkout went on to calculate both. Whatever the wording
// becomes, it must not contradict the page it leads to.
test('the cart drawer does not contradict the calculated checkout', async ({ page }) => {
    await seedGuestCart(page, [CART_LINE]);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(() => window.storeCart.open());

    const drawer = page.locator('#cart-drawer, [data-cart-drawer]').first();
    await expect(drawer).toBeVisible({ timeout: 15000 });

    await expect(drawer).toContainText(/calculated at checkout/i);
    await expect(drawer).not.toContainText(/quoted separately/i);
});

// ---------------------------------------------------------------------------
// 11. AN OVERLAID SURFACE IS THE ONLY THING THAT SCROLLS
// ---------------------------------------------------------------------------
// Reported from a phone: reading a product overlay to its end and continuing
// to drag scrolled the STORE behind it, which then stayed where it had been
// dragged once the overlay closed.
//
// Two mechanics, and each test below is one of them. The lock has to hold —
// `document.body.style.overflow = 'hidden'`, which is what every surface used
// to do, is advisory on iOS Safari — and the gesture has to stop at the edge of
// the surface rather than being handed outwards, which is `overscroll-behavior`
// and which no scroller carried. See scroll-lock-module.js.
//
// A phone viewport, because that is where it was seen and where the surfaces
// are full-bleed.
const PHONE = { width: 390, height: 844 };

const bodyState = (page) => page.evaluate(() => ({
    position: getComputedStyle(document.body).position,
    top: getComputedStyle(document.body).top,
    // With the page held there is nothing left to scroll: a fixed body has no
    // scrollport, so the document collapses to the viewport.
    scrollable: document.documentElement.scrollHeight - window.innerHeight > 1,
    y: window.scrollY,
    depth: window.srkScrollLock ? window.srkScrollLock.depth() : null
}));

test('an open overlay holds the store still, and gives back the same scroll position', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedGuestCart(page, [CART_LINE]);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Somewhere down the page, so a restore to 0 is distinguishable from a
    // restore to where the customer actually was.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const before = await page.evaluate(() => window.scrollY);

    await page.evaluate(() => window.storeCart.open());
    await expect(page.locator('#cart-drawer')).toBeVisible({ timeout: 15000 });

    const locked = await bodyState(page);
    expect(locked.position, 'the page must be pinned, not merely overflow:hidden').toBe('fixed');
    expect(locked.top).toBe(`-${before}px`);
    expect(locked.scrollable, 'nothing behind the overlay may still scroll').toBe(false);
    expect(locked.depth).toBe(1);

    await page.evaluate(() => window.storeCart.close());
    await expect(page.locator('#cart-drawer')).toHaveCount(0, { timeout: 15000 });
    await expect.poll(() => page.evaluate(() => window.srkScrollLock.depth())).toBe(0);

    const released = await bodyState(page);
    expect(released.position).toBe('static');
    expect(released.y, 'the store must come back where it was left').toBe(before);
});

// Each of these is a scrolling region that sits over something else. Chained,
// they were all handing the gesture to the page behind them.
for (const surface of [
    {
        name: 'the cart drawer',
        open: (page) => page.evaluate(() => window.storeCart.open()),
        scroller: '#cart-drawer-scroll'
    },
    {
        name: 'the product details overlay',
        open: async (page) => {
            await page.locator('article[data-product-id]').first().click();
        },
        scroller: '#product-details-scroll'
    }
]) {
    test(`${surface.name} does not hand its overscroll to the page behind it`, async ({ page }) => {
        await page.setViewportSize(PHONE);
        await seedGuestCart(page, [CART_LINE]);
        await page.reload({ waitUntil: 'domcontentloaded' });

        await surface.open(page);
        const scroller = page.locator(surface.scroller);
        await expect(scroller).toBeVisible({ timeout: 15000 });

        // The computed value, not the class list: a class that never reached
        // the stylesheet would pass a class-name assertion and fail a customer.
        await expect.poll(() => scroller.evaluate(
            el => getComputedStyle(el).overscrollBehaviorY
        )).toBe('contain');
    });
}

// The lock is counted, and the count is shared. A dialog opening over the cart
// and closing again must not release the page while the cart is still there —
// which is what two surfaces with private counters would do.
test('a dialog over the cart releases the page only once both have gone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedGuestCart(page, [CART_LINE]);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await page.evaluate(() => window.scrollY);

    await page.evaluate(() => window.storeCart.open());
    await expect(page.locator('#cart-drawer')).toBeVisible({ timeout: 15000 });

    const closeDialog = await page.evaluate(() => {
        const close = window.storeOverlay.openChoiceDialog({
            host: document.getElementById('cart-drawer'),
            idPrefix: 'test-dialog',
            title: 'A question',
            body: '<p>Well?</p>',
            actions: [{ label: 'No' }, { label: 'Yes', primary: true }]
        });
        window.__closeTestDialog = close;
        return typeof close === 'function';
    });
    expect(closeDialog, 'the dialog must actually open for this to prove anything').toBe(true);

    expect((await bodyState(page)).depth).toBe(2);

    // Polled: every surface here unlocks after its own fade-out, so the count
    // drops a couple of hundred milliseconds after the call, not during it.
    await page.evaluate(() => window.__closeTestDialog());
    await expect.poll(() => page.evaluate(() => window.srkScrollLock.depth())).toBe(1);
    expect((await bodyState(page)).position, 'the cart is still open, so the page stays held').toBe('fixed');

    await page.evaluate(() => window.storeCart.close());
    await expect(page.locator('#cart-drawer')).toHaveCount(0, { timeout: 15000 });

    await expect.poll(() => page.evaluate(() => window.srkScrollLock.depth())).toBe(0);
    const released = await bodyState(page);
    expect(released.position).toBe('static');
    expect(released.y).toBe(before);
});

// The mobile navigation panel is the same kind of surface on every one of the
// 17 documents, and on the marketing pages it opens over Lenis — which drives
// scrolling from its own animation loop and re-asserts a target every frame.
// It would undo both halves of the fix on the next frame, so it is stopped for
// the duration and told where the page ended up. This is the test that says so.
test('the mobile navigation panel holds a Lenis page still', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(await page.evaluate(() => !!window.lenis), 'the home page should be running Lenis').toBe(true);

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    const before = await page.evaluate(() => window.scrollY);

    await page.locator('.srk-mobile-menu-button').click();
    const panel = page.locator('.srk-mobile-panel');
    await expect(panel).toBeVisible();

    expect((await bodyState(page)).position).toBe('fixed');
    await expect.poll(() => panel.evaluate(el => getComputedStyle(el).overscrollBehaviorY)).toBe('contain');

    const publicVisualState = await panel.evaluate(node => {
        const home = Array.from(node.querySelectorAll('.srk-mobile-panel__group a'))
            .find(link => link.textContent.trim() === 'Home');
        const foot = node.querySelector('.srk-mobile-panel__foot');
        const logo = node.querySelector('.srk-mobile-panel__head img');
        return {
            width: parseFloat(getComputedStyle(node).width),
            background: getComputedStyle(node).backgroundColor,
            logoHeight: parseFloat(getComputedStyle(logo).height),
            homeBackground: getComputedStyle(home).backgroundColor,
            footBorder: getComputedStyle(foot).borderTopWidth,
            footLabels: Array.from(foot.querySelectorAll('a')).map(link => link.textContent.trim())
        };
    });

    expect(publicVisualState.width).toBe(300);
    expect(publicVisualState.background).toBe('rgb(255, 255, 255)');
    expect(publicVisualState.logoHeight).toBe(60);
    expect(publicVisualState.homeBackground).toBe('rgba(212, 175, 55, 0.1)');
    expect(publicVisualState.footBorder).toBe('1px');
    expect(publicVisualState.footLabels).toEqual(['Request a Quote', 'Need Assistance?']);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.srkScrollLock.depth())).toBe(0);

    // Lenis animates towards a target it holds itself, so this is polled: the
    // assertion is that it ends up back where the visitor was, not that it
    // arrives in the same tick.
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(before);
    expect((await bodyState(page)).position).toBe('static');
});

test('the mobile store drawer retains its original navigation system', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });

    const trigger = page.locator('.srk-shell-menu-button');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const drawer = page.locator('.srk-store-sidebar');
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await expect(drawer.locator('.srk-store-drawer-head')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const visualState = await drawer.evaluate(node => {
        const active = node.querySelector('#policy-nav .nav-btn[class~="text-[#d4af37]"]');
        const support = node.querySelector('#policy-nav-secondary');
        const logo = node.querySelector('img[alt="SRK Team Star Home"]');
        return {
            width: parseFloat(getComputedStyle(node).width),
            background: getComputedStyle(node).backgroundColor,
            logoHeight: parseFloat(getComputedStyle(logo).height),
            activeBackground: getComputedStyle(active).backgroundColor,
            supportBackground: getComputedStyle(support).backgroundColor,
            supportBorder: getComputedStyle(support).borderTopWidth,
            overscroll: getComputedStyle(node).overscrollBehaviorY
        };
    });

    expect(visualState.width).toBe(300);
    expect(visualState.background).toBe('rgb(255, 255, 255)');
    expect(visualState.logoHeight).toBe(60);
    expect(visualState.activeBackground).toBe('rgba(212, 175, 55, 0.1)');
    expect(visualState.supportBackground).toBe('rgba(0, 0, 0, 0)');
    expect(visualState.supportBorder).toBe('1px');
    expect(visualState.overscroll).toBe('contain');

    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveAttribute('data-open', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.srkScrollLock.depth())).toBe(0);
});
