#!/usr/bin/env node
// =============================================================================
// check-webhook.js — prove /api/webhooks/razorpay works, without Razorpay
// =============================================================================
//
//   node scripts/check-webhook.js                 # http://localhost:$PORT
//   node scripts/check-webhook.js https://x.trycloudflare.com
//
// WHAT THIS IS FOR
// ----------------
// Setting up a webhook has four things that can be wrong and one symptom for
// all of them ("Razorpay says delivery failed"). This separates them, and it
// does it before the gateway is involved, so a real failed delivery later
// means the one thing this could not test rather than any of the four:
//
//   1. the server is not running / not reachable at that URL
//   2. PAYMENTS_ENABLED is unset, so the route answers 404 and does not exist
//   3. the raw-body capture is broken, so no signature can ever verify
//   4. the route is reachable but rejects a signature it should accept
//
// WHAT IT CANNOT TEST, AND THIS IS THE POINT
// ------------------------------------------
// Whether RAZORPAY_WEBHOOK_SECRET here is the same string you typed into the
// Razorpay dashboard. This script signs with the local secret and the server
// verifies with the local secret, so it agrees with itself by construction.
// Only a real delivery proves the two match — and when one fails after this
// script passes, a mismatched secret is very nearly the only thing left.
//
// IT DELIBERATELY USES AN EVENT THE HANDLER IGNORES
// -------------------------------------------------
// `payment.authorized` is a real Razorpay event type that server.js records
// and does not act on. So this exercises the whole path — raw bytes, HMAC,
// the append to payment_events, the reply — and cannot mark anything paid.
// Nothing here goes near markOrderPaid().
//
// IT DOES WRITE. Two rows land in `payment_events`: the accepted delivery and
// the forged one. That table is an append-only audit log whose whole purpose
// is to record what arrived, including what failed verification — a probe of
// this endpoint is exactly the kind of thing it exists to show. No other table
// is touched.
// =============================================================================

const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const secret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const base = (process.argv[2] || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const url = base + '/api/webhooks/razorpay';

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    if (ok) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};

// The bytes are built once and signed as-is. Re-serialising before sending
// would be the exact bug this route's comments warn about: Razorpay signs what
// it sent, and JSON.stringify of a parsed body is not those bytes.
function delivery(eventId) {
    const body = Buffer.from(JSON.stringify({
        entity: 'event',
        account_id: 'acc_checkwebhook',
        event: 'payment.authorized',
        contains: ['payment'],
        payload: {
            payment: {
                entity: {
                    id: 'pay_checkwebhook_' + eventId,
                    entity: 'payment',
                    amount: 100,
                    currency: 'INR',
                    status: 'authorized',
                    order_id: 'order_checkwebhook',
                    method: 'upi',
                    notes: {}
                }
            }
        },
        created_at: Math.floor(Date.now() / 1000)
    }), 'utf8');

    return body;
}

const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function post(body, signature, eventId) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Razorpay-Signature': signature,
            'X-Razorpay-Event-Id': eventId
        },
        body
    });

    let payload = null;
    const text = await response.text();
    try { payload = JSON.parse(text); } catch { payload = text; }

    return { status: response.status, body: payload };
}

(async () => {
    console.log('\nTarget: ' + url + '\n');

    if (!secret) {
        console.log('  RAZORPAY_WEBHOOK_SECRET is empty in backend/.env. Nothing to test.\n');
        process.exit(1);
    }

    // Reachability first, so a connection refused is reported as itself rather
    // than as every assertion below failing for no stated reason.
    const eventId = 'evt_check_' + crypto.randomUUID();
    const body = delivery(eventId);

    let genuine;
    try {
        genuine = await post(body, sign(body), eventId);
    } catch (error) {
        console.log('  FAIL  the endpoint is reachable');
        console.log('        ' + error.message);
        console.log('\n        Is the server running?  cd backend && npm start');
        console.log('        If the URL is a tunnel, is the tunnel still up?\n');
        process.exit(1);
    }

    check('the endpoint is reachable', true);

    // A TUNNEL THAT IS UP IS NOT AN ORIGIN THAT IS UP, and this script got
    // that wrong the first time it was pointed at one: cloudflared answered
    // Cloudflare's own 502 page, which is a perfectly good HTTP response, so
    // "reachable" passed and the 404 test below did not match either — the run
    // reported "payments are switched on" for a server that was not running at
    // all. Separating failure modes is the entire job here, so a gateway error
    // gets named as itself and stops the run.
    if ([502, 503, 504, 521, 522, 523, 524, 530].includes(genuine.status)) {
        check('something is actually listening behind that URL', false,
            `The tunnel answered ${genuine.status} — it is up, but it could not reach the server it forwards to.\n` +
            '        Start the backend (cd backend && npm start) and check the tunnel points at the same port.');
        console.log('');
        process.exit(1);
    }

    // Anything that is not JSON did not come from this app. A login wall, a
    // proxy error page, or the wrong host entirely all land here rather than
    // being reported as some confusing assertion failure further down.
    if (typeof genuine.body !== 'object' || genuine.body === null) {
        check('that URL is this application', false,
            `Got ${genuine.status} and a non-JSON body, so the reply came from something other than this server.\n` +
            '        First 120 chars: ' + String(genuine.body).replace(/\s+/g, ' ').slice(0, 120));
        console.log('');
        process.exit(1);
    }

    if (genuine.status === 404) {
        check('payments are switched on', false,
            'The route answered 404, which is what it does when PAYMENTS_ENABLED is unset. ' +
            'Set PAYMENTS_ENABLED=1 in backend/.env and restart the server.');
        console.log('');
        process.exit(1);
    }
    check('payments are switched on', true);

    check('a correctly signed delivery is accepted',
        genuine.status === 200, 'got ' + genuine.status + ' ' + JSON.stringify(genuine.body));

    // The half that would still pass if signature checking had been commented
    // out — which is the thing that quietly happens to webhook handlers under
    // deadline pressure. Asserted so it cannot happen here unnoticed.
    const forgedId = 'evt_check_' + crypto.randomUUID();
    const forgedBody = delivery(forgedId);
    const forged = await post(forgedBody, 'f'.repeat(64), forgedId);

    check('a forged signature is refused',
        forged.status === 400, 'got ' + forged.status + ' ' + JSON.stringify(forged.body) +
        '  <-- signature verification is NOT working; do not go live');

    // Migration 014's unique index on payment_events.event_id. Razorpay retries
    // until it gets a 2xx, so a redelivery must be a 200 no-op and not a second
    // recording of the same event.
    const replay = await post(body, sign(body), eventId);
    check('a redelivered event is a 200 no-op',
        replay.status === 200 && replay.body && replay.body.duplicate === true,
        'got ' + replay.status + ' ' + JSON.stringify(replay.body));

    console.log('\n' + '='.repeat(60));
    console.log(`${pass} passed, ${fail} failed`);
    if (!fail) {
        console.log('\nThe endpoint works. What this could NOT check is whether the');
        console.log('secret here matches the one in the Razorpay dashboard — only a');
        console.log('real delivery proves that. If one fails after this passed, that');
        console.log('mismatch is the first thing to suspect.');
    }
    console.log('='.repeat(60) + '\n');

    process.exit(fail ? 1 : 0);
})();
