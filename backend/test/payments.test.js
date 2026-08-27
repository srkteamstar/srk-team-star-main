// =============================================================================
// payments.test.js — the gateway's refusals, against the stubbed server (3456)
// =============================================================================
//
// Every test here is an attack or a failure mode named in the threat model,
// not a happy path with the edges filled in. The happy path is checked once,
// at the top, because the refusals below are only meaningful if the thing they
// refuse would otherwise have worked.
//
// The fake gateway lives in authz-harness.js and encodes its answer in the
// payment id — pay_<status>_<amountPaise>_<gatewayOrderId> — so a test can ask
// for "captured but the wrong amount" by naming it.
// =============================================================================

const crypto = require('crypto');
const control = require('./harness-control');

const BASE = 'http://localhost:3456';
const KEY_SECRET = 'harness-razorpay-key-secret';
const WEBHOOK_SECRET = 'harness-razorpay-webhook-secret';

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

const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

const checkoutSignature = (gatewayOrderId, paymentId) =>
    sign(KEY_SECRET, `${gatewayOrderId}|${paymentId}`);

// Product 1 is priced '1000' in the stub; product 2 is 'On request'.
//
// No expected total is written down here on purpose. GST_RATE, SHIPPING_FLAT
// and SHIPPING_FREE_ABOVE are commercial constants the business changes, and a
// suite that hardcodes the figure they produce fails on a correct edit and
// teaches everyone to ignore it. Every assertion below derives the amount from
// the server's own answer instead.
const CART = [{ product_id: 1, quantity: 1 }];

const CONTACT = (n) => ({
    name: 'Pay Tester', email: `payer${n}@example.test`, phone: `90000100${n}`, company: null
});

const ADDRESS = {
    address_line: '1 Test Road', city: 'Gohana', state: 'Haryana', postal_code: '131301', country: 'India'
};

async function placeOrder(cookies, n) {
    const r = await req(cookies, 'POST', '/api/checkout', {
        items: CART, contact: CONTACT(n), address: ADDRESS
    });
    return r;
}

// A webhook delivery signed the way Razorpay signs one: HMAC over the exact
// bytes. Built as a string here and sent verbatim, because signing a
// re-serialised object is the bug this whole route is shaped around.
async function sendWebhook(eventId, event, entity, options) {
    const body = JSON.stringify({
        entity: 'event',
        event: event,
        payload: { payment: { entity: entity } }
    });

    const signature = (options && options.signature !== undefined)
        ? options.signature
        : sign(WEBHOOK_SECRET, body);

    const res = await fetch(BASE + '/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': eventId
        },
        body: body
    });

    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: res.status, body: payload };
}

(async () => {
    console.log('\n=== 1. THE ORDER IS CREATED UNPAID, AND SAYS SO ===');

    const buyer = jar();
    let r = await placeOrder(buyer, 1);

    check('checkout returns a gateway handshake', r.status === 201 && r.body.payment && r.body.payment.gateway_order_id,
        JSON.stringify(r.body).slice(0, 140));
    check('...carrying the PUBLIC key id only',
        r.body.payment && r.body.payment.key_id === 'rzp_test_harness',
        String(r.body.payment && r.body.payment.key_id));
    check('...and never the key secret or webhook secret',
        !JSON.stringify(r.body).includes(KEY_SECRET) && !JSON.stringify(r.body).includes(WEBHOOK_SECRET),
        'a secret appeared in the checkout response');

    const orderA = { id: r.body.order_id, ref: r.body.reference, ...r.body.payment };

    // DERIVED, NOT HARDCODED. This asserted `=== 295000` and broke the moment
    // SHIPPING_FLAT was changed — which is a legitimate configuration change,
    // not a regression. Worse, the magic number was testing the commercial
    // constants rather than the property that actually matters here:
    //
    //   the integer paise sent to the gateway equals the rupee total this
    //   server computed, exactly, with no floating-point drift
    //
    // That is the invariant toPaise() exists for (orders' money columns are
    // still `double precision`), and it holds at any shipping rate or GST
    // slab. Priced through the same summary route the checkout page uses, so
    // a drift between what is displayed and what is charged fails here too.
    const summaryA = await req(buyer, 'POST', '/api/checkout/summary', { items: CART });
    const expectedPaise = Math.round((summaryA.body.totals.total + Number.EPSILON) * 100);

    check('the amount is exact integer paise, matching the priced total',
        Number.isInteger(orderA.amount_paise) && orderA.amount_paise === expectedPaise,
        `charged ${orderA.amount_paise} vs priced ${expectedPaise} (₹${summaryA.body.totals.total})`);

    const good = `pay_captured_${orderA.amount_paise}_${orderA.gateway_order_id}`;

    console.log('\n=== 2. THE FOUR CONDITIONS, EACH REFUSED ON ITS OWN ===');

    // (a) A forged signature. Nothing else about this request is wrong.
    r = await req(buyer, 'POST', '/api/payments/verify', {
        order_id: orderA.id,
        razorpay_order_id: orderA.gateway_order_id,
        razorpay_payment_id: good,
        razorpay_signature: 'deadbeef'.repeat(8)
    });
    check('a forged signature is refused', r.status === 400, JSON.stringify(r.body));

    // (b) THE ONE MOST INTEGRATIONS MISS.
    //     A genuine Razorpay signature, correctly verified — but issued for a
    //     different, cheaper order. Signature verification alone says yes.
    const buyerB = jar();
    const second = await placeOrder(buyerB, 2);
    const orderB = { id: second.body.order_id, ...second.body.payment };
    const paymentForB = `pay_captured_${orderB.amount_paise}_${orderB.gateway_order_id}`;

    r = await req(buyer, 'POST', '/api/payments/verify', {
        order_id: orderA.id,                              // our expensive order
        razorpay_order_id: orderB.gateway_order_id,       // ...someone else's payment
        razorpay_payment_id: paymentForB,
        razorpay_signature: checkoutSignature(orderB.gateway_order_id, paymentForB)  // GENUINE
    });
    check('a VALID signature from another order is refused (replay)',
        r.status === 409 && r.body.reason === 'order_mismatch', JSON.stringify(r.body));

    // (c) Right order, right signature, wrong amount.
    const cheap = `pay_captured_100_${orderA.gateway_order_id}`;
    r = await req(buyer, 'POST', '/api/payments/verify', {
        order_id: orderA.id,
        razorpay_order_id: orderA.gateway_order_id,
        razorpay_payment_id: cheap,
        razorpay_signature: checkoutSignature(orderA.gateway_order_id, cheap)
    });
    check('a captured payment for the wrong amount is refused',
        r.status === 409 && r.body.reason === 'mismatch', JSON.stringify(r.body));

    // (d) Authorised but never captured. Money has not moved.
    const orderC = await placeOrder(jar(), 3);
    const pending = `pay_authorized_${orderC.body.payment.amount_paise}_${orderC.body.payment.gateway_order_id}`;
    r = await req(buyer, 'POST', '/api/payments/verify', {
        order_id: orderC.body.order_id,
        razorpay_order_id: orderC.body.payment.gateway_order_id,
        razorpay_payment_id: pending,
        razorpay_signature: checkoutSignature(orderC.body.payment.gateway_order_id, pending)
    });
    check('an authorised-but-uncaptured payment is refused',
        r.status === 409 && r.body.reason === 'mismatch', JSON.stringify(r.body));

    console.log('\n=== 3. A REAL PAYMENT IS ACCEPTED, ONCE ===');

    const clean = jar();
    const fresh = await placeOrder(clean, 4);
    const orderD = { id: fresh.body.order_id, ...fresh.body.payment };
    const paidId = `pay_captured_${orderD.amount_paise}_${orderD.gateway_order_id}`;

    r = await req(clean, 'POST', '/api/payments/verify', {
        order_id: orderD.id,
        razorpay_order_id: orderD.gateway_order_id,
        razorpay_payment_id: paidId,
        razorpay_signature: checkoutSignature(orderD.gateway_order_id, paidId)
    });
    check('a genuine, matching payment is accepted', r.status === 200 && r.body.paid === true, JSON.stringify(r.body));

    // Idempotent: the callback fires again (a double-submit, a retry).
    r = await req(clean, 'POST', '/api/payments/verify', {
        order_id: orderD.id,
        razorpay_order_id: orderD.gateway_order_id,
        razorpay_payment_id: paidId,
        razorpay_signature: checkoutSignature(orderD.gateway_order_id, paidId)
    });
    check('...and confirming it a second time is a no-op, not an error',
        r.status === 200 && r.body.paid === true && r.body.already === true, JSON.stringify(r.body));

    console.log('\n=== 4. THE WEBHOOK IS THE AUTHORITY, AND IT REPEATS ITSELF ===');

    const webhookBuyer = jar();
    const wh = await placeOrder(webhookBuyer, 5);
    const orderE = { id: wh.body.order_id, ...wh.body.payment };
    const whPayment = `pay_captured_${orderE.amount_paise}_${orderE.gateway_order_id}`;

    const entity = {
        id: whPayment,
        order_id: orderE.gateway_order_id,
        amount: orderE.amount_paise,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        notes: { order_id: String(orderE.id) }
    };

    // An unsigned delivery. This is someone who found the URL.
    r = await sendWebhook('evt_forged_1', 'payment.captured', entity, { signature: 'not-a-signature' });
    check('an unsigned webhook is refused', r.status === 400, JSON.stringify(r.body));

    // ...and the customer's order is untouched by it.
    r = await req(webhookBuyer, 'GET', '/api/orders/mine');
    const stillUnpaid = (r.body || []).find(o => o.id === orderE.id);
    check('...and it did not mark anything paid',
        stillUnpaid && stillUnpaid.payment_status !== 'Paid',
        JSON.stringify(stillUnpaid && stillUnpaid.payment_status));

    // The genuine delivery.
    r = await sendWebhook('evt_real_1', 'payment.captured', entity);
    check('a signed webhook is accepted', r.status === 200 && r.body.received === true, JSON.stringify(r.body));

    r = await req(webhookBuyer, 'GET', '/api/orders/mine');
    const nowPaid = (r.body || []).find(o => o.id === orderE.id);
    check('...and the order is now paid and moved to Processing',
        nowPaid && nowPaid.payment_status === 'Paid' && nowPaid.status === 'Processing',
        JSON.stringify(nowPaid && { s: nowPaid.status, p: nowPaid.payment_status }));

    // Razorpay redelivers on any non-2xx, and sometimes on a slow 2xx.
    r = await sendWebhook('evt_real_1', 'payment.captured', entity);
    check('the SAME delivery again is a 200 no-op, not a second payment',
        r.status === 200 && r.body.duplicate === true, JSON.stringify(r.body));

    console.log('\n=== 5. NOTHING A BROWSER CAN REACH SETS "Paid" ===');

    // The naive integration's endpoint, and the shape of the request that
    // walks straight through it. There must be no such route.
    for (const path of ['/api/payment-success', '/api/payments/mark-paid', '/api/orders/' + orderA.id + '/pay']) {
        r = await req(buyer, 'POST', path, { order_id: orderA.id, status: 'Paid' });
        check(`POST ${path} does not exist`, r.status === 404, String(r.status));
    }

    // There is no order-status route on this application at all: fulfilment
     // is not the storefront's job, so a customer asking for one is answered
     // the way anybody asking for a route that does not exist is answered.
    r = await req(buyer, 'PATCH', `/api/orders/${orderA.id}/status`, { status: 'Pending Payment' });
    check('a customer cannot PATCH an order status at all', r.status === 404, String(r.status));

    console.log('\n=== 6. THE UNPAID ORDER STAYS UNPAID AND VISIBLE ===');

    r = await req(buyer, 'GET', '/api/orders/mine');
    const unpaid = (r.body || []).find(o => o.id === orderA.id);
    check('the order survived every refused attempt above',
        unpaid && unpaid.status === 'Pending Payment',
        JSON.stringify(unpaid && unpaid.status));
    check('...and its payment is not Paid',
        unpaid && unpaid.payment_status !== 'Paid',
        JSON.stringify(unpaid && unpaid.payment_status));

    console.log('\n=== 7. THE CUSTOMER PICKS THE FLOW, AND THE PICK REACHES THE DATABASE ===');

    // The gateway being ON no longer means every order goes through it. These
    // assert the branch both ways on the SAME server, in the same run — which
    // is the only arrangement that can catch the two failures worth catching:
    // a COD order that quietly creates a Razorpay order, and an online order
    // that quietly places itself unpaid.

    // ---- Cash on Delivery -------------------------------------------------
    const codBuyer = jar();
    r = await req(codBuyer, 'POST', '/api/checkout', {
        items: CART, contact: CONTACT(70), address: ADDRESS,
        payment_mode: 'offline', payment_method: 'Cash on Delivery'
    });
    check('a Cash on Delivery order is accepted while the gateway is on',
        r.status === 200 || r.status === 201, JSON.stringify(r).slice(0, 140));

    // The load-bearing one. `payment` is the gateway handshake; its absence is
    // what stops the page opening a modal, and it can only be absent if the
    // server never created a Razorpay order.
    check('...and carries NO gateway handshake',
        r.body && !r.body.payment, JSON.stringify(r.body).slice(0, 140));

    const codRef = r.body && r.body.reference;
    let mine = await req(codBuyer, 'GET', '/api/orders/mine');
    const cod = (mine.body || []).find(o => o.reference === codRef);

    check('...the order is PLACED, not awaiting a payment that is not coming',
        cod && cod.status === 'Processing', JSON.stringify(cod && cod.status));
    check('...its payment is Pending, for the sales team to settle',
        cod && cod.payment_status === 'Pending', JSON.stringify(cod && cod.payment_status));
    check('...and the chosen method was stored',
        cod && cod.payment_method === 'Cash on Delivery', JSON.stringify(cod && cod.payment_method));

    // ---- Pay now, on the same server --------------------------------------
    const onlineBuyer = jar();
    r = await req(onlineBuyer, 'POST', '/api/checkout', {
        items: CART, contact: CONTACT(71), address: ADDRESS,
        payment_mode: 'online', payment_method: 'Cash on Delivery'
    });
    check('an online order on the same server DOES get a handshake',
        r.status < 300 && r.body && r.body.payment && r.body.payment.gateway_order_id,
        JSON.stringify(r.body).slice(0, 140));

    const onlineRef = r.body && r.body.reference;
    mine = await req(onlineBuyer, 'GET', '/api/orders/mine');
    const online = (mine.body || []).find(o => o.reference === onlineRef);

    check('...and it opens unpaid',
        online && online.status === 'Pending Payment', JSON.stringify(online && online.status));

    // The instrument sent alongside an online mode is IGNORED, not stored. A
    // gateway payment's instrument is whatever Razorpay reports at capture,
    // and accepting 'Cash on Delivery' here would put a flat lie in the
    // ledger — an order marked paid by card and filed as cash.
    check('...and the payment_method sent with it was ignored, not stored',
        online && online.payment_method === null, JSON.stringify(online && online.payment_method));

    // ---- The body is not trusted about the instrument either ---------------
    const oddBuyer = jar();
    r = await req(oddBuyer, 'POST', '/api/checkout', {
        items: CART, contact: CONTACT(72), address: ADDRESS,
        payment_mode: 'offline', payment_method: 'Goats'
    });
    mine = await req(oddBuyer, 'GET', '/api/orders/mine');
    const odd = (mine.body || []).find(o => o.reference === (r.body && r.body.reference));

    // Falls back rather than failing: an unrecognised instrument is a stale or
    // hand-made client, and the order is otherwise perfectly good. Refusing it
    // would fail a customer over a cosmetic field.
    check('an unrecognised instrument falls back instead of failing the order',
        odd && odd.status === 'Processing' && odd.payment_method === 'Cash on Delivery',
        JSON.stringify(odd && { s: odd.status, m: odd.payment_method }));

    console.log('\n=== 8. AN UNPAID ORDER IS RESUMABLE, AND CLOSEABLE, BY ITS OWNER ===');

    // Every assertion below reuses an order placed earlier in this file.
    // checkoutLimiter allows 15 writes per window and both suites share one
    // server and one IP, so a section that placed four more orders would be
    // one edit away from failing the suite it was added to protect.

    // ---- The handshake comes back, so the modal can be reopened -----------
    //
    // This is what makes an abandoned payment recoverable rather than a dead
    // end. Without it the handshake existed only in checkout-module.js's
    // memory, so a reload lost it, the cart was (correctly) never cleared, and
    // the customer placed a SECOND order for the same goods while the first
    // sat unpaid forever holding a real order number.
    check('an unpaid order carries a gateway handshake in the order history',
        Boolean(online && online.payment && online.payment.gateway_order_id),
        JSON.stringify(online && online.payment));
    check('...with the PUBLIC key id, and no secret anywhere in the response',
        online && online.payment && online.payment.key_id === 'rzp_test_harness' &&
        !JSON.stringify(mine.body).includes(KEY_SECRET) && !JSON.stringify(mine.body).includes(WEBHOOK_SECRET),
        String(online && online.payment && online.payment.key_id));
    check('...and it is flagged cancellable',
        online && online.can_cancel === true, JSON.stringify(online && online.can_cancel));

    // ---- A placed order offers neither ------------------------------------
    check('a Cash on Delivery order carries NO handshake to resume',
        cod && !cod.payment, JSON.stringify(cod && cod.payment));
    check('...and is not cancellable from the storefront',
        cod && cod.can_cancel === false, JSON.stringify(cod && cod.can_cancel));

    // ---- It is the OWNER's order, and nobody else's -----------------------
    const onlineOrderId = online && online.id;

    r = await req(codBuyer, 'POST', `/api/orders/${onlineOrderId}/cancel`);
    check("another customer cannot cancel somebody else's order",
        r.status === 404, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

    // A FRESH jar. The suite's other jars have all walked a guest checkout,
    // and POST /api/checkout creates the account an order needs and signs it
    // in — so asking "can a signed-out visitor do this?" through one of those
    // would answer through a real session and pass for the wrong reason. The
    // same trap section 18 of authz.test.js documents.
    r = await req(jar(), 'POST', `/api/orders/${onlineOrderId}/cancel`);
    check('a signed-out visitor cannot cancel anything',
        r.status === 401, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

    // ---- THE RACE. The gateway is asked, and it wins ----------------------
    //
    // orderA is still 'Pending Payment' — every attempt against it in sections
    // 2-4 was refused. Telling the fake gateway that money landed against its
    // order is the situation of a customer standing in the modal in a second
    // tab: our payments row says unpaid, and cancelling on the strength of it
    // would close an order that is being paid for right now. markOrderPaid()'s
    // own order update is guarded on the awaiting-payment status, so the money
    // would then land against a Cancelled row and stay there.
    control.setPaidOrders([orderA.gateway_order_id]);

    r = await req(buyer, 'POST', `/api/orders/${orderA.id}/cancel`);
    check('cancel is REFUSED when the gateway reports money against the order',
        r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

    r = await req(buyer, 'GET', '/api/orders/mine');
    const stillOpen = (r.body || []).find(o => o.id === orderA.id);
    check('...and the order is left exactly as it was',
        stillOpen && stillOpen.status === 'Pending Payment',
        JSON.stringify(stillOpen && stillOpen.status));

    control.reset();

    // ---- The ordinary case ------------------------------------------------
    r = await req(onlineBuyer, 'POST', `/api/orders/${onlineOrderId}/cancel`);
    check('the owner can cancel an unpaid order the gateway has no money for',
        r.status === 200 && r.body && r.body.cancelled === true,
        `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

    mine = await req(onlineBuyer, 'GET', '/api/orders/mine');
    const cancelled = (mine.body || []).find(o => o.id === onlineOrderId);

    check('...the order reads Cancelled afterwards',
        cancelled && cancelled.status === 'Cancelled', JSON.stringify(cancelled && cancelled.status));
    check('...and stops offering a handshake or a cancel',
        cancelled && !cancelled.payment && cancelled.can_cancel === false,
        JSON.stringify(cancelled && { p: cancelled.payment, c: cancelled.can_cancel }));

    // Idempotent, and reported as success. A double-click, or a retry after a
    // dropped response, must not read as a failure for work already done.
    r = await req(onlineBuyer, 'POST', `/api/orders/${onlineOrderId}/cancel`);
    check('cancelling the same order again is a success, not an error',
        r.status === 200 && r.body && r.body.already === true,
        `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

    // ---- The two refusals that protect fulfilment and money ---------------
    r = await req(codBuyer, 'POST', `/api/orders/${cod.id}/cancel`);
    check('an order already being processed cannot be cancelled from the storefront',
        r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

    // webhookBuyer's order was marked Paid by a genuine signed webhook in
    // section 4. Money moved; a storefront button must not close it.
    const paidOrder = (await req(webhookBuyer, 'GET', '/api/orders/mine')).body[0];
    r = await req(webhookBuyer, 'POST', `/api/orders/${paidOrder.id}/cancel`);
    check('a PAID order cannot be cancelled from the storefront',
        r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    check('...and it is still Paid afterwards',
        (await req(webhookBuyer, 'GET', '/api/orders/mine')).body[0].payment_status === 'Paid',
        'the refused cancel changed the payment status');

    console.log('\n=== 9. THE OFFLINE INSTRUMENTS ARE PUBLISHED, NOT DUPLICATED ===');

    // The other half of this — that 'Pending Payment' is an expressible
    // status on a fulfilment route — is not this application's to prove.
    // This suite deliberately never signs in as one: both doors share a single
    // authLimiter of 20 per window and the two suites already spend 18.

    // The offline instruments are published from the one list that validates
    // them, so the page cannot offer a method the server will silently rewrite.
    r = await req(jar(), 'POST', '/api/checkout/summary', { items: CART });
    check('the summary publishes the offline payment methods',
        r.status === 200 && Array.isArray(r.body.payment_methods) && r.body.payment_methods.length > 0,
        JSON.stringify(r.body && r.body.payment_methods));
    check('...and the first of them is what an unrecognised instrument falls back to',
        r.body.payment_methods[0] === 'Cash on Delivery' && odd.payment_method === 'Cash on Delivery',
        JSON.stringify(r.body.payment_methods));

    // The picker is pay-now versus pay-on-receipt, so the offline half is one
    // instrument. Asserted as a set rather than a length so the failure names
    // what came back: the methods that were retired (Bank Transfer, UPI as an
    // offline claim, Cheque) must not reappear here — an offline 'UPI' next to
    // the gateway's real one is the specific trap this replaced.
    check('...and the retired offline instruments are gone',
        !r.body.payment_methods.some(m => m === 'Bank Transfer' || m === 'UPI' || m === 'Cheque'),
        JSON.stringify(r.body.payment_methods));

    console.log('\n' + '='.repeat(64));
    console.log(`PAYMENTS: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
})();
