// The storefront's authorization matrix, against the stubbed server (port 3456).
//
// WHAT THIS SUITE IS FOR: proving that the only thing this application will
// open a session for is a customer, that one customer cannot reach another's
// data, and that no public write can raise a role or name its own price.
//
// It exercises the routes this process serves and no others. A fixture row
// whose role is not 'customer' is here on purpose - the roles table is real,
// and the storefront has to refuse such an account at its door. That is
// section 1.
const BASE = 'http://localhost:3456';
const crypto = require('crypto');
const control = require('./harness-control');
const PASSWORD = 'correct-horse-42';

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

// A cookie jar per actor, so sessions do not bleed between them.
function jar() {
    const store = new Map();
    return {
        header: () => [...store.entries()].map(([k, v]) => k + '=' + v).join('; '),
        absorb: (res) => {
            const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
            raw.forEach(line => {
                const [pair] = line.split(';');
                const idx = pair.indexOf('=');
                store.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            });
        },
        clear: () => store.clear()
    };
}

async function req(cookies, method, path, body, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    const cookieHeader = cookies ? cookies.header() : '';
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    if (cookies) cookies.absorb(res);

    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: res.status, body: payload };
}

(async () => {
    const anon = jar(), custA = jar(), custB = jar(), other = jar();

    console.log('\n=== 1. CUSTOMER SIGN-IN REQUIRES A PASSWORD ===');

    // THE DOOR OPENS FOR CUSTOMERS AND FOR NOBODY ELSE, and it says nothing
    // about what it refused. An earlier version answered a non-customer
    // account with a flag naming the role, which turned a route anybody may
    // call into a way to ask "is this address privileged?" of an address
    // somebody had already guessed.
    let r = await req(other, 'POST', '/api/auth/login', { identifier: 'other-role@example.test', password: PASSWORD });
    check('an account that is not a customer is refused here', r.status === 403, JSON.stringify(r));
    check('...and the refusal does not name the role it refused',
        !JSON.stringify(r.body).toLowerCase().includes('admin'), JSON.stringify(r.body));
    r = await req(other, 'GET', '/api/orders/mine');
    check('...and that refusal started no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: 'wrong-password' });
    check('a wrong password is refused', r.status === 401 && r.body.field === 'password', JSON.stringify(r));
    r = await req(custA, 'GET', '/api/orders/mine');
    check('...and starts no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('customer signs in with an identifier and password',
        r.status === 200 && r.body.customer.role === 'customer', JSON.stringify(r).slice(0, 120));
    check('the password hash is never returned', !JSON.stringify(r.body).includes('password_hash'), JSON.stringify(r.body));
    r = await req(custB, 'POST', '/api/auth/login', { identifier: 'b@example.test', password: PASSWORD });
    check('second customer signs in', r.status === 200, JSON.stringify(r).slice(0, 80));

    const legacy = jar();
    r = await req(legacy, 'POST', '/api/auth/login', { identifier: 'c@example.test', password: PASSWORD });
    check('a legacy profile with no hash is locked, not treated as passwordless',
        r.status === 403 && r.body.field === 'password', JSON.stringify(r));
    r = await req(legacy, 'GET', '/api/orders/mine');
    check('...and that locked profile received no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    const unassigned = jar();
    r = await req(unassigned, 'POST', '/api/auth/login', { identifier: 'unassigned@example.test', password: PASSWORD });
    check('an account with a missing role fails closed at sign-in', r.status === 403, JSON.stringify(r));
    r = await req(unassigned, 'GET', '/api/orders/mine');
    check('...and receives no storefront session', r.status === 401, JSON.stringify(r));

    console.log('\n=== 2. IDOR — one customer cannot read another\'s orders ===');
    const aOrders = await req(custA, 'GET', '/api/orders/mine');
    const bOrders = await req(custB, 'GET', '/api/orders/mine');
    check('customer A sees only their own order',
        aOrders.status === 200 && aOrders.body.length === 1 && aOrders.body[0].id === 900,
        JSON.stringify(aOrders.body).slice(0, 160));
    check('customer B sees only their own order',
        bOrders.status === 200 && bOrders.body.length === 1 && bOrders.body[0].id === 901,
        JSON.stringify(bOrders.body).slice(0, 160));
    check('A\'s payload contains nothing belonging to B',
        !JSON.stringify(aOrders.body).includes('2 B Street') && !JSON.stringify(aOrders.body).includes('TRK-B'),
        JSON.stringify(aOrders.body).slice(0, 200));

    console.log('\n=== 2A. PURCHASE INVOICES ARE OWNER-ONLY FROZEN RECORDS ===');
    r = await req(jar(), 'GET', '/api/orders/900/invoice');
    check('a guest cannot read an invoice', r.status === 401, JSON.stringify(r).slice(0, 100));

    r = await req(custA, 'GET', '/api/orders/900/invoice');
    check('the owner receives the formal invoice contract',
        r.status === 200 && r.body.invoice.number === 'INV-20260201-000900' &&
        r.body.invoice.order_reference === 'ORD-2026-900' && r.body.snapshot.complete === true,
        JSON.stringify(r.body).slice(0, 240));
    check('invoice line descriptions and prices come from the order snapshot',
        r.body.items.length === 1 && r.body.items[0].description === 'Fake Machine' &&
        r.body.items[0].unit_price === 1000 && r.body.items[0].taxable_value === 1000,
        JSON.stringify(r.body.items));
    check('the invoice reconciles persisted totals and split Haryana GST',
        r.body.totals.subtotal === 1000 && r.body.totals.cgst === 90 &&
        r.body.totals.sgst === 90 && r.body.totals.igst === 0 && r.body.totals.grand_total === 1180,
        JSON.stringify(r.body.totals));
    check('COD remains Pending and is not presented as money received',
        r.body.payment.status === 'Pending' && r.body.payment.method === 'Cash on Delivery' && r.body.payment.paid === false,
        JSON.stringify(r.body.payment));

    r = await req(custA, 'GET', '/api/orders/901/invoice');
    check('another customer\'s invoice is indistinguishable from a missing invoice',
        r.status === 404 && !JSON.stringify(r.body).includes('B'), JSON.stringify(r));
    r = await req(custB, 'GET', '/api/orders/901/invoice');
    check('a settled invoice shows verified payment metadata to its owner',
        r.status === 200 && r.body.payment.status === 'Paid' && r.body.payment.paid === true &&
        r.body.payment.transaction_reference === 'pay_SETTLED' && r.body.payment.verified_at === '2026-02-02T00:05:00Z',
        JSON.stringify(r.body.payment));

    console.log('\n=== 3. MASS ASSIGNMENT / ROLE ESCALATION ===');
    r = await req(custA, 'PATCH', '/api/auth/me', { name: 'Still A', role_id: 1, id: 100, email: 'other-role@example.test' });
    const after = await req(custA, 'GET', '/api/auth/me');
    check('PATCH /api/auth/me cannot set role_id',
        after.body.customer.role === 'customer', JSON.stringify(after.body.customer));
    check('PATCH /api/auth/me cannot change id or email',
        after.body.customer.id === 200 && after.body.customer.email === 'a@example.test',
        JSON.stringify(after.body.customer));
    r = await req(custA, 'GET', '/api/orders/900/invoice');
    check('editing the profile does not rewrite the buyer frozen on the invoice',
        r.status === 200 && r.body.buyer.name === 'Fake Customer A', JSON.stringify(r.body.buyer));
    r = await req(custA, 'GET', '/api/auth/me');
    check('still a customer after the attempt',
        r.body.customer && r.body.customer.role === 'customer', JSON.stringify(r.body.customer));

    r = await req(jar(), 'POST', '/api/auth/register',
        { name: 'No Secret', email: 'no-secret@example.test', phone: '9000000098' });
    check('register refuses to create a passwordless account',
        r.status === 400 && r.body.field === 'password', JSON.stringify(r));

    r = await req(anon, 'POST', '/api/auth/register',
        { name: 'Escalate', email: 'esc@example.test', phone: '9000000099', password: PASSWORD, role_id: 1 });
    check('register cannot self-assign another role',
        r.status === 201 && r.body.customer.role === 'customer', JSON.stringify(r.body).slice(0, 140));

    r = await req(jar(), 'POST', '/api/auth/register', {
        name: 'x'.repeat(5000), email: 'bounded@example.test', phone: '9000000097',
        company: 'y'.repeat(5000), password: PASSWORD
    });
    check('registration rejects oversized profile fields before writing', r.status === 400, JSON.stringify(r));

    r = await req(custA, 'PATCH', '/api/auth/me', { address_line: 'x'.repeat(5000) });
    check('profile editing rejects an oversized address before writing', r.status === 400, JSON.stringify(r));

    console.log('\n=== 4. GUEST CHECKOUT CAPTURES CONTACT WITHOUT CREATING AN ACCOUNT ===');
    const guest = jar();
    r = await req(guest, 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Guest Buyer', email: 'other-role@example.test', phone: '9111111111' },
        address: { address_line: 'Guest Road', city: 'Gohana', state: 'Haryana', postal_code: '131301' },
        payment_mode: 'offline', payment_method: 'Cash on Delivery'
    });
    const guestOrderId = r.body && r.body.order_id;
    const guestOrderToken = r.body && r.body.order_access_token;
    check('checkout needs no password and returns one-order guest access',
        r.status === 201 && r.body.customer === null && /^[A-Za-z0-9_-]{40,100}$/.test(guestOrderToken || ''),
        r.status + ' ' + JSON.stringify(r.body).slice(0, 180));
    r = await req(guest, 'GET', '/api/auth/me');
    check('guest checkout creates no account session', r.status === 200 && r.body.customer === null, JSON.stringify(r).slice(0, 90));

    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/invoice`);
    check('a guest invoice is private without its token', r.status === 401, JSON.stringify(r));
    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/invoice`, undefined,
        { 'X-Order-Access-Token': 'x'.repeat(43) });
    check('a wrong guest token does not reveal whether the invoice exists', r.status === 404, JSON.stringify(r));
    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/invoice`, undefined,
        { 'X-Order-Access-Token': guestOrderToken });
    check('the checkout token opens only that guest invoice',
        r.status === 200 && r.body.buyer.name === 'Guest Buyer' && r.body.buyer.email === 'other-role@example.test' &&
        !JSON.stringify(r.body).includes('guest_access_token_hash'), JSON.stringify(r.body).slice(0, 240));

    r = await req(jar(), 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Guest Buyer', email: 'bounded-checkout@example.test', phone: '9111111111' },
        address: { address_line: 'x'.repeat(5000), city: 'Gohana', state: 'Haryana', postal_code: '131301' },
        payment_mode: 'offline'
    });
    check('guest checkout rejects an oversized delivery address before pricing or writing',
        r.status === 400, JSON.stringify(r));

    console.log('\n=== 4B. GET /api/orders/:id/status — SAME BOUNDARY AS THE INVOICE ROUTE ===');
    // The route a checkout tab polls to learn a webhook-settled order without
    // ever needing full order history. Same accessibleOrder() boundary as
    // the invoice route above, so the same three cases apply.
    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/status`);
    check('a guest order status is private without its token', r.status === 401, JSON.stringify(r));
    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/status`, undefined,
        { 'X-Order-Access-Token': 'x'.repeat(43) });
    check('a wrong guest token does not reveal whether the order exists', r.status === 404, JSON.stringify(r));
    r = await req(jar(), 'GET', `/api/orders/${guestOrderId}/status`, undefined,
        { 'X-Order-Access-Token': guestOrderToken });
    check('the checkout token reads that guest order\'s status',
        r.status === 200 && r.body.order_id === guestOrderId && typeof r.body.status === 'string' && r.body.requires_review === false,
        JSON.stringify(r.body).slice(0, 200));

    r = await req(custA, 'GET', '/api/orders/900/status');
    check('a customer reads their own order status', r.status === 200 && r.body.order_id === 900, JSON.stringify(r.body));
    r = await req(custB, 'GET', '/api/orders/900/status');
    check('...but not another customer\'s', r.status === 404, JSON.stringify(r));

    console.log('\n=== 4C. A LOST CHECKOUT RESPONSE, THEN A RETRY, IS ONE ORDER ===');
    // Same idempotency key on two otherwise-identical requests must return
    // the SAME order rather than writing a second one for the same basket.
    // A REAL crypto.randomUUID()-shaped key, on purpose (audit finding S04):
    // checkout.controller.js now requires the retry key to look like one of
    // these or it is treated as though none were sent at all.
    const retryKey = crypto.randomUUID();
    const retryProof = crypto.randomUUID();
    const retryGuest = jar();
    const retryBody = () => ({
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Retry Guest', email: 'retry-guest@example.test', phone: '9333333333' },
        address: { address_line: 'Retry Road', city: 'Gohana', state: 'Haryana', postal_code: '131301' },
        payment_mode: 'offline', idempotency_key: retryKey, checkout_proof: retryProof
    });
    const firstAttempt = await req(retryGuest, 'POST', '/api/checkout', retryBody());
    check('the first attempt places an order normally',
        firstAttempt.status === 201 && firstAttempt.body.order_id, JSON.stringify(firstAttempt.body).slice(0, 160));
    check('...and names its lifecycle state explicitly (F01)',
        firstAttempt.body.checkout_state === 'placed', JSON.stringify(firstAttempt.body.checkout_state));

    const secondAttempt = await req(retryGuest, 'POST', '/api/checkout', retryBody());
    check('a retry with the same idempotency key returns the SAME order, not a new one',
        secondAttempt.status === 200 && secondAttempt.body.order_id === firstAttempt.body.order_id,
        `first=${firstAttempt.body.order_id} second=${JSON.stringify(secondAttempt.body).slice(0, 160)}`);
    check('...reporting the SAME frozen totals rather than re-pricing (F08)',
        JSON.stringify(secondAttempt.body.totals) === JSON.stringify(firstAttempt.body.totals),
        JSON.stringify({ first: firstAttempt.body.totals, second: secondAttempt.body.totals }));

    // The retry mints a FRESH guest token rather than replaying the first
    // one — the plaintext token is never stored, so if the first response
    // had genuinely been lost this is the only way back to the order at all.
    check('...and the retry response still carries a working guest token',
        /^[A-Za-z0-9_-]{40,100}$/.test(secondAttempt.body.order_access_token || ''),
        JSON.stringify(secondAttempt.body).slice(0, 160));
    r = await req(jar(), 'GET', `/api/orders/${firstAttempt.body.order_id}/status`, undefined,
        { 'X-Order-Access-Token': secondAttempt.body.order_access_token });
    check('...and that fresh token actually opens the order',
        r.status === 200 && r.body.order_id === firstAttempt.body.order_id, JSON.stringify(r.body));

    // The heavier S04/F08/F01 scenarios below this point — weak-key
    // rejection, a guest-proof mismatch, a changed-basket retry, cross-
    // account key replay, and the 502-then-retry gateway-failure sequence —
    // moved to their own self-contained suite (checkout-hardening.test.js),
    // each against a freshly spawned harness on its own port. checkoutLimiter
    // is a real 15-per-15-minutes-per-IP limiter shared by every request this
    // whole `npm test` run makes against ONE harness instance (see section
    // 8's comment in payments.test.js), and this suite plus payments.test.js
    // already spend exactly that budget between them — there is no room left
    // here for the extra attempts those scenarios need.

    console.log('\n=== 5. EXISTING CONTACT DETAILS STILL REMAIN A GUEST ORDER ===');
    const guest2 = jar();
    r = await req(guest2, 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Delivery Contact', email: 'a@example.test', phone: '9222222222' },
        address: { address_line: 'ORDER-ONLY ADDRESS', city: 'Nowhere', state: 'NA', postal_code: '999999' },
        payment_mode: 'online'
    });
    const guest2OrderId = r.body && r.body.order_id;
    const guest2Token = r.body && r.body.order_access_token;
    check('an existing account email can be used as guest contact without adopting it',
        r.status === 201 && r.body.customer === null && r.body.order_access_token,
        r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    const guest2Profile = await req(guest2, 'GET', '/api/auth/me');
    check('...and checkout did not mint a session',
        guest2Profile.status === 200 && guest2Profile.body.customer === null,
        guest2Profile.status + ' ' + JSON.stringify(guest2Profile.body).slice(0, 120));
    const aProfile = await req(custA, 'GET', '/api/auth/me');
    check('customer A\'s saved address is untouched',
        aProfile.body.customer.address_line === '1 A Street',
        'is now: ' + aProfile.body.customer.address_line);
    r = await req(jar(), 'POST', `/api/orders/${guest2OrderId}/cancel`, undefined,
        { 'X-Order-Access-Token': guest2Token });
    check('the same guest token can cancel that unpaid order',
        r.status === 200 && r.body.cancelled === true, JSON.stringify(r));

    console.log('\n=== 6. ORDER WRITES ARE ATOMIC ===');
    const beforeAtomic = await req(custA, 'GET', '/api/orders/mine');
    control.failNextAtomicCheckout();
    r = await req(jar(), 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 2 }],
        contact: { name: 'Atomic Test', email: 'atomic@example.test', phone: '9333333333' },
        address: { address_line: '3 Test Street', city: 'Rajkot', state: 'Gujarat', postal_code: '360001' },
        payment_mode: 'offline', payment_method: 'Cash on Delivery'
    });
    check('a database failure refuses the checkout', r.status === 500, JSON.stringify(r).slice(0, 120));
    const afterAtomic = await req(custA, 'GET', '/api/orders/mine');
    check('...and leaves no partial order behind',
        afterAtomic.status === 200 && afterAtomic.body.length === beforeAtomic.body.length,
        `${beforeAtomic.body.length} before, ${afterAtomic.body.length} after`);

    console.log('\n=== 7. PRICE IS SERVER-SIDE (client cannot name it) ===');
    r = await req(anon, 'POST', '/api/checkout/summary',
        { items: [{ product_id: 1, quantity: 1, price: 1, unit_price: 1, line_total: 1 }] });
    check('posted price is ignored; server prices from the catalogue',
        r.status === 200 && r.body.lines[0].unit_price === 1000,
        JSON.stringify(r.body.lines).slice(0, 140));
    r = await req(anon, 'POST', '/api/checkout/summary', { items: [{ product_id: 2, quantity: 1 }] });
    check('an "On request" product is blocked, not silently priced',
        r.status === 200 && r.body.blocked.length === 1 && r.body.blocked[0].reason === 'on_request',
        JSON.stringify(r.body).slice(0, 140));

    r = await req(anon, 'POST', '/api/quote-requests/calculate', {
        items: [{ product_id: 1, quantity: 2, product_name: 'Forged name', product_price: 1, gst_rate: 0 }]
    });
    check('quote preview ignores browser names, prices and tax rates',
        r.status === 200 && r.body.lines[0].product_name === 'Fake Machine' &&
        r.body.lines[0].unit_price === 1000 && r.body.lines[0].gst_amount === 360 &&
        r.body.totals.estimated_total === 2360,
        JSON.stringify(r.body).slice(0, 220));

    r = await req(anon, 'POST', '/api/quote-requests/calculate', {
        items: [{ product_id: 2, quantity: 3 }]
    });
    check('quote preview preserves an on-request product without inventing a total',
        r.status === 200 && r.body.can_submit === true &&
        r.body.lines[0].pricing_status === 'on_request' &&
        r.body.totals.pricing_complete === false && r.body.totals.estimated_total === null,
        JSON.stringify(r.body).slice(0, 220));

    console.log('\n=== 8. INPUT BOUNDS ON ANONYMOUS WRITE ROUTES ===');
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'x'.repeat(5000), email: 'e@example.test', message: 'hi' });
    check('over-long name is refused', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'ok', email: 'not-an-email', message: 'hi' });
    check('malformed email is refused (was unchecked here)', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'ok', email: 'e@example.test', message: 'hi' });
    check('a legitimate enquiry still submits', r.status === 200, JSON.stringify(r).slice(0, 90));

    r = await req(anon, 'POST', '/api/quote-requests', {
        business_name: 'Quantity Test', contact_name: 'Buyer', email: 'buyer@example.test',
        business_address: 'Rajkot, Gujarat',
        items: [{ category_name: 'Forged Category', product_name: 'Forged Machine', product_price: 1, product_id: 1, category_id: 999, quantity: 7 }]
    });
    check('a quote accepts an explicit line quantity and returns an immutable reference',
        r.status === 200 && /^PI-\d{4}-\d+$/.test(r.body.reference), JSON.stringify(r).slice(0, 140));
    check('the final quote snapshot is recalculated from the catalogue',
        r.body.snapshot && r.body.snapshot.lines[0].quantity === 7 &&
        r.body.snapshot.lines[0].product_name === 'Fake Machine' &&
        r.body.snapshot.lines[0].category_name === 'Machinery' &&
        r.body.snapshot.lines[0].unit_price === 1000 &&
        r.body.snapshot.lines[0].line_total === 8260,
        JSON.stringify(r.body).slice(0, 240));

    control.failNextQuoteRpcMissing();
    r = await req(anon, 'POST', '/api/quote-requests', {
        business_name: 'Compatibility Business', contact_name: 'Migration Window',
        email: 'compatibility@example.test', business_address: 'Gohana, Haryana',
        notes: 'Requirements and quantities supplied by the customer.',
        items: [{ product_id: 1, quantity: 2, product_price: 1, product_name: 'Forged' }]
    });
    check('a quote still saves while migration 029 is waiting to be applied',
        r.status === 200 && r.body.success === true && /^PI-\d{4}-\d+$/.test(r.body.reference),
        JSON.stringify(r).slice(0, 180));
    check('the compatibility write still uses the server product and price snapshot',
        r.body.snapshot.lines[0].product_name === 'Fake Machine' &&
        r.body.snapshot.lines[0].unit_price === 1000 && r.body.snapshot.lines[0].quantity === 2,
        JSON.stringify(r.body.snapshot.lines[0]));

    console.log('\n=== 9. UNKNOWN IDENTIFIER IS FLAGGED, NOT JUST 404ed ===');
    r = await req(jar(), 'POST', '/api/auth/login', { identifier: 'nobody@example.test', password: PASSWORD });
    check('login for an unknown account answers 404 with account_not_found',
        r.status === 404 && r.body.account_not_found === true, JSON.stringify(r).slice(0, 120));
    check('...and does not start a session',
        !r.body.customer, JSON.stringify(r).slice(0, 90));

    console.log('\n=== 10. SIGN-OUT ACTUALLY ENDS THE SESSION ===');
    const bye = jar();
    r = await req(bye, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('signed in before signing out', r.status === 200, JSON.stringify(r).slice(0, 60));
    r = await req(bye, 'POST', '/api/auth/logout', {});
    check('logout returns 200', r.status === 200, JSON.stringify(r).slice(0, 60));
    r = await req(bye, 'GET', '/api/orders/mine');
    check('the order history is closed after logout', r.status === 401, r.status);
    r = await req(bye, 'GET', '/api/auth/me');
    check('...and the storefront reads nobody as signed in',
        r.status === 200 && r.body.customer === null, JSON.stringify(r).slice(0, 80));

    console.log('\n=== 11. SESSION FIXATION ===');
    const fix = jar();
    await req(fix, 'GET', '/api/auth/me');
    const before = fix.header();
    await req(fix, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('session id is regenerated on sign-in', fix.header() !== before || before === '',
        'before=' + before.slice(0, 30) + ' after=' + fix.header().slice(0, 30));

    console.log('\n=== 12. CROSS-ORIGIN ===');
    const cors = await fetch(BASE + '/api/auth/me', { headers: { Origin: 'https://evil.example' } });
    check('no ACAO for a foreign origin', !cors.headers.get('access-control-allow-origin'),
        String(cors.headers.get('access-control-allow-origin')));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'x', email: 'e@example.test', message: 'y' },
        { Origin: 'https://evil.example' });
    check('cross-origin state change is refused', r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 60));

    console.log('\n=== 13. A CART BELONGS TO ONE ACCOUNT, AND TO NOBODY ELSE ===');

    // custA is customer 200 and has been signed in since section 4. custB is
    // customer 201, blocked and then unblocked in section 13 — a block refuses
    // a session, it does not destroy one, so that jar is a working customer
    // session again. Reusing both is not just tidiness: authLimiter allows 20
    // sign-in attempts per window and this suite already spends 17 of them.

    // A guest cart never reaches the server at all, so both doors are shut
    // rather than answering with an empty one.
    //
    // Use a fresh jar so this assertion cannot inherit any earlier session.
    const noSession = jar();
    r = await req(noSession, 'GET', '/api/cart');
    check('a guest cannot read a cart', r.status === 401, JSON.stringify(r).slice(0, 80));
    r = await req(noSession, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 1 }] });
    check('a guest cannot write one', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'PUT', '/api/cart', {
        items: [{ id: 1, name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 3 }]
    });
    check('A saves a cart',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    r = await req(custA, 'GET', '/api/cart');
    check('...and reads it back with the snapshot intact',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === '1' &&
        r.body.items[0].name === 'Fake Machine' && r.body.items[0].price === '1000',
        JSON.stringify(r).slice(0, 160));

    // The whole reason this moved off localStorage.
    r = await req(custB, 'GET', '/api/cart');
    check("B cannot see A's cart",
        r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 140));

    // "On request" is a legal price in this catalogue, which is why the
    // snapshot column is text. A numeric column would store null here and the
    // drawer would show a blank where the shelf shows a sentence.
    r = await req(custB, 'PUT', '/api/cart', {
        items: [{ id: 2, name: 'Fake On Request', category_name: 'Machinery', price: 'On request', image_url: '', quantity: 1 }]
    });
    check('B saves their own',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].price === 'On request',
        JSON.stringify(r).slice(0, 140));

    r = await req(custA, 'GET', '/api/cart');
    check("...without disturbing A's",
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === '1' && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Signing out hides a cart; it does not destroy one. That is the whole
    // difference between this and wiping localStorage on logout.
    await req(custA, 'POST', '/api/auth/logout', {});
    r = await req(custA, 'GET', '/api/cart');
    check('signed out, the cart is unreachable', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('A signs back in', r.status === 200, JSON.stringify(r).slice(0, 80));
    r = await req(custA, 'GET', '/api/cart');
    check('...and the basket is exactly where they left it',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Bounds, and they are checkout's numbers on purpose: a cart that can hold
    // more than an order can carry is a trap sprung at the last screen.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 0 }] });
    check('a quantity of 0 is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 'not-a-product', quantity: 1 }] });
    check('an unparseable product id is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', { items: 'a cart, honestly' });
    check('a cart that is not a list is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', {
        items: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, quantity: 1 }))
    });
    check('51 lines is refused', r.status === 400, JSON.stringify(r).slice(0, 100));

    r = await req(custA, 'GET', '/api/cart');
    check('...and not one of those refusals half-applied',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Duplicates collapse and cap rather than failing the write: the unique
    // index makes two lines for one product unstorable, so meaning the
    // sensible thing beats a 400 nobody can act on.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 60 }, { id: 1, quantity: 60 }] });
    check('duplicate lines collapse and cap at 99',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 99,
        JSON.stringify(r).slice(0, 140));

    // Truncation, not refusal, for the snapshot columns — they are copies of
    // our own catalogue row, and failing a customer's cart over our data entry
    // would be the wrong trade.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, name: 'x'.repeat(5000), quantity: 1 }] });
    check('an over-long product name is truncated, not refused',
        r.status === 200 && r.body.items[0].name.length === 200, JSON.stringify(r).slice(0, 100));

    // Emptying is an ordinary write, and is what checkout does on success.
    r = await req(custA, 'PUT', '/api/cart', { items: [] });
    check('a cart can be emptied', r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'GET', '/api/cart');
    check('...and stays empty', r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 100));
    r = await req(custB, 'GET', '/api/cart');
    check("B's cart survived A emptying theirs",
        r.status === 200 && r.body.items.length === 1, JSON.stringify(r).slice(0, 140));

    console.log('\n=== 19. CART WRITES ARE REVISION-CHECKED, NOT LAST-WRITE-WINS (F06) ===');
    // A's cart is empty after section 18. GET carries the revision that read
    // reflects — the number cart-module.js is now expected to carry forward
    // on its next PUT (migration 036's replace_customer_cart).
    r = await req(custA, 'GET', '/api/cart');
    const revBase = r.body.revision;
    check('GET /api/cart reports a numeric revision', Number.isInteger(revBase), JSON.stringify(r.body).slice(0, 100));

    r = await req(custA, 'PUT', '/api/cart', {
        items: [{ id: 1, name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 1 }],
        revision: revBase
    });
    check('a write carrying the CURRENT revision succeeds and reports the new one',
        r.status === 200 && r.body.revision === revBase + 1, JSON.stringify(r.body).slice(0, 140));
    const revAfterFirst = r.body.revision;

    // A second write still naming the NOW-STALE revision — the shape of two
    // overlapping writes for the same customer, or a second tab that has not
    // re-read since the first tab's save landed — must be refused rather
    // than silently applied over the newer state.
    r = await req(custA, 'PUT', '/api/cart', {
        items: [{ id: 1, name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 9 }],
        revision: revBase
    });
    check('a write carrying a STALE revision is refused with 409, not applied (F06)',
        r.status === 409 && r.body.revision === revAfterFirst,
        `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

    r = await req(custA, 'GET', '/api/cart');
    check('...and the stale write left the cart exactly as the winning write left it',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 1 && r.body.revision === revAfterFirst,
        JSON.stringify(r.body).slice(0, 140));

    // A write naming no revision at all — an old client, or the first save
    // this browser has ever made — is not refused for it: the same
    // unconditional "last write wins" the route always offered.
    r = await req(custA, 'PUT', '/api/cart', {
        items: [{ id: 1, name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 5 }]
    });
    check('a write with no revision at all still succeeds (backward compatible)',
        r.status === 200 && r.body.items[0].quantity === 5, JSON.stringify(r.body).slice(0, 140));

    console.log('\n' + '='.repeat(64));
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
})();
