// =============================================================================
// checkout-hardening.test.js — S04 / F01 / F08, against their OWN harness
// =============================================================================
//
// WHY THIS SUITE SPAWNS ITS OWN SERVER, RATHER THAN JOINING authz.test.js OR
// payments.test.js ON THE SHARED ONE
// -----------------------------------------------------------------------------
// checkoutLimiter is a real 15-attempts-per-15-minutes-per-IP limiter, and
// run.js already spends that whole budget across authz.test.js and
// payments.test.js against the one harness they share (see the comment in
// payments.test.js section 8). Every scenario below needs its OWN checkout
// attempts — a weak key that must NOT collapse two writes into one, a guest
// impersonation attempt, a changed-basket retry, a cross-account replay, a
// simulated gateway outage and its retry — and there is no room left in that
// shared budget for them. A second harness process, on its own port, gets its
// own in-memory rate-limit counters for free and does not touch the first.
//
// This file is spawned by run.js exactly like authz.test.js and
// payments.test.js are, but unlike them it boots and tears down its own
// server rather than assuming one is already listening.
// =============================================================================

const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

// A dedicated port, and set into THIS process's env before harness-control.js
// is required: controlPath() there keys its file name on process.env.HARNESS_PORT,
// and both this file's calls (failNextGatewayOrderCreate, reset) and the
// spawned child's reads have to compute the SAME path — or this suite would
// silently share (and collide with) the OTHER harness's control file on the
// default port instead of talking to its own.
const PORT = process.env.HARNESS_PORT && process.env.HARNESS_PORT !== '3456'
    ? process.env.HARNESS_PORT
    : '3458';
process.env.HARNESS_PORT = PORT;

const control = require('./harness-control');
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

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
        }
    };
}

async function req(cookies, method, path, body, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    const cookieHeader = cookies ? cookies.header() : '';
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetch(BASE + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    if (cookies) cookies.absorb(res);

    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: res.status, body: payload };
}

const ADDRESS = { address_line: 'Hardening Road', city: 'Gohana', state: 'Haryana', postal_code: '131301' };
const contactFor = (n) => ({ name: `Hardening Guest ${n}`, email: `hardening${n}@example.test`, phone: `93444444${String(n).padStart(2, '0')}` });

async function main() {
    // ---- 1. THE STRONG-KEY FORMAT REQUIREMENT (S04) — a unit-level check on
    // the exact helper checkout.controller.js now gates every retry key
    // through, so it costs nothing against the shared rate-limit budget and
    // pins the boundary precisely: what crypto.randomUUID() produces passes,
    // the old Math.random-shaped fallback and short/hand-picked values do not.
    const { isStrongRetryToken } = require('../src/shared/order-access-token');
    check('crypto.randomUUID() output is accepted as a retry key',
        isStrongRetryToken(crypto.randomUUID()), 'a real UUID was rejected');
    check('the old Math.random-shaped fallback key is rejected',
        !isStrongRetryToken('idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)),
        'a weak fallback-shaped key was accepted');
    check('a short hand-picked value is rejected', !isStrongRetryToken('1'), 'accepted "1"');
    check('an empty/missing key is rejected', !isStrongRetryToken('') && !isStrongRetryToken(undefined), 'accepted empty/undefined');

    console.log('\n=== 2. A WEAK-SHAPED IDEMPOTENCY KEY IS NOT HONOURED AS ONE (S04) ===');
    const weakGuest = jar();
    const weakKey = 'idem-test-' + Date.now();
    const weakBody = { items: [{ product_id: 1, quantity: 1 }], contact: contactFor(1), address: ADDRESS, payment_mode: 'offline', idempotency_key: weakKey };
    const weakFirst = await req(weakGuest, 'POST', '/api/checkout', weakBody);
    const weakSecond = await req(weakGuest, 'POST', '/api/checkout', weakBody);
    check('both attempts place an order',
        weakFirst.status === 201 && weakSecond.status === 201,
        `${weakFirst.status} ${weakSecond.status}`);
    check('...but a weak key does not collapse them into one order — each attempt wrote its own (S04)',
        weakFirst.body.order_id !== weakSecond.body.order_id,
        `first=${weakFirst.body.order_id} second=${weakSecond.body.order_id}`);

    console.log('\n=== 3. A GUEST RETRY REQUIRES ITS OWN PROOF, NOT JUST THE KEY (S04) ===');
    const owner = jar();
    const realKey = crypto.randomUUID();
    const realProof = crypto.randomUUID();
    const ownerBody = { items: [{ product_id: 1, quantity: 1 }], contact: contactFor(2), address: ADDRESS, payment_mode: 'offline', idempotency_key: realKey, checkout_proof: realProof };
    const created = await req(owner, 'POST', '/api/checkout', ownerBody);
    check('the owning guest places an order carrying a key and a proof',
        created.status === 201 && created.body.order_id, JSON.stringify(created.body).slice(0, 160));

    const impostor = jar();
    const impostorAttempt = await req(impostor, 'POST', '/api/checkout', Object.assign({}, ownerBody, { checkout_proof: crypto.randomUUID() }));
    check('knowing the retry key without the matching checkout proof reports "not found", not the order (S04)',
        impostorAttempt.status === 404, `${impostorAttempt.status} ${JSON.stringify(impostorAttempt.body).slice(0, 140)}`);

    const legitimateRetry = await req(owner, 'POST', '/api/checkout', ownerBody);
    check('...while the real owner presenting the SAME proof still recovers the order',
        legitimateRetry.status === 200 && legitimateRetry.body.order_id === created.body.order_id,
        JSON.stringify(legitimateRetry.body).slice(0, 160));

    const statusWithFreshToken = await req(jar(), 'GET', `/api/orders/${created.body.order_id}/status`, undefined,
        { 'X-Order-Access-Token': legitimateRetry.body.order_access_token });
    check("...and the impostor's rejected attempt did not rotate/invalidate the real guest's token",
        statusWithFreshToken.status === 200 && statusWithFreshToken.body.order_id === created.body.order_id,
        JSON.stringify(statusWithFreshToken.body).slice(0, 140));

    console.log('\n=== 4. A CHANGED BASKET CANNOT SILENTLY RECOVER A FROZEN ORDER (F08) ===');
    const changedRetry = await req(owner, 'POST', '/api/checkout', Object.assign({}, ownerBody, {
        items: [{ product_id: 1, quantity: 2 }] // quantity 1 -> 2 since the original attempt
    }));
    check('a retry whose basket changed since the original attempt is refused with 409, not re-priced (F08)',
        changedRetry.status === 409, `${changedRetry.status} ${JSON.stringify(changedRetry.body).slice(0, 140)}`);

    console.log('\n=== 5. AN ACCOUNT ORDER\'S RETRY KEY BELONGS TO THAT ACCOUNT (S04) ===');
    const custA = jar(), custB = jar();
    let login = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: 'correct-horse-42' });
    check('customer A signs in', login.status === 200, JSON.stringify(login.body).slice(0, 120));
    login = await req(custB, 'POST', '/api/auth/login', { identifier: 'b@example.test', password: 'correct-horse-42' });
    check('customer B signs in', login.status === 200, JSON.stringify(login.body).slice(0, 120));

    const acctKey = crypto.randomUUID();
    const acctBody = { items: [{ product_id: 1, quantity: 1 }], address: ADDRESS, payment_mode: 'offline', idempotency_key: acctKey };
    const acctOrder = await req(custA, 'POST', '/api/checkout', acctBody);
    check('customer A places an order carrying an idempotency key',
        acctOrder.status === 201 && acctOrder.body.order_id, JSON.stringify(acctOrder.body).slice(0, 140));

    const replay = await req(custB, 'POST', '/api/checkout', acctBody);
    check("customer B replaying A's retry key is refused, not handed A's order (S04)",
        replay.status === 404, `${replay.status} ${JSON.stringify(replay.body).slice(0, 140)}`);

    console.log('\n=== 6. A RETRY AFTER A FAILED GATEWAY SETUP MUST NEVER CONFIRM (F01) ===');
    // Reproduces the audit's exact reproduction: gateway order creation
    // fails (502), the local order is cancelled, and a retry with the SAME
    // idempotency key must be told plainly this attempt is closed — never
    // handed a working-looking 200 that clears the cart on nothing.
    const failedGuest = jar();
    const failedKey = crypto.randomUUID();
    const failedBody = { items: [{ product_id: 1, quantity: 1 }], contact: contactFor(3), address: ADDRESS, payment_mode: 'online', idempotency_key: failedKey };

    control.failNextGatewayOrderCreate();
    const setupFailure = await req(failedGuest, 'POST', '/api/checkout', failedBody);
    check('a gateway outage during setup cancels the order and reports 502 with an explicit failed state',
        setupFailure.status === 502 && setupFailure.body.checkout_state === 'failed' && setupFailure.body.order_id,
        `${setupFailure.status} ${JSON.stringify(setupFailure.body).slice(0, 160)}`);

    const retryAfterFailure = await req(failedGuest, 'POST', '/api/checkout', failedBody);
    check('retrying with the same key after that failure is refused with 409, not confirmed as placed (F01)',
        retryAfterFailure.status === 409 &&
        retryAfterFailure.body.checkout_state === 'failed' &&
        retryAfterFailure.body.order_id === setupFailure.body.order_id,
        `${retryAfterFailure.status} ${JSON.stringify(retryAfterFailure.body).slice(0, 160)}`);

    console.log('\n' + '='.repeat(64));
    console.log(`CHECKOUT HARDENING: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    return fail;
}

// ---- Boot a private harness on its own port, run main(), tear it down -----
const server = spawn(process.execPath, [path.join(__dirname, 'authz-harness.js')], {
    env: Object.assign({}, process.env, { HARNESS_PORT: PORT }),
    stdio: ['ignore', 'pipe', 'inherit']
});

let booted = false;
server.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    if (booted) return;
    if (String(chunk).includes('Server running')) {
        booted = true;
        control.reset();
        main()
            .then(failCount => { server.kill(); process.exit(failCount ? 1 : 0); })
            .catch(error => { console.error(error); server.kill(); process.exit(1); });
    }
});

setTimeout(() => {
    if (!booted) { console.error('Checkout-hardening harness did not start in 20s.'); server.kill(); process.exit(1); }
}, 20000);
