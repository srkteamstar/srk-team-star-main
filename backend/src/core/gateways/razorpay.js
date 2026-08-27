// =============================================================================
// razorpay.js — the gateway, on node's own crypto and fetch
// =============================================================================
//
// WHY THERE IS NO SDK HERE
// ------------------------
// The `razorpay` npm package would work. It is also a dependency tree in a
// repository that just cut 75 declared dependencies to 7, and everything it
// does for this integration is three things node already has:
//
//   * an HTTP call with Basic auth        -> fetch, built in since node 18
//   * HMAC-SHA256                         -> crypto
//   * a constant-time compare             -> crypto.timingSafeEqual
//
// Same call totp.js made, for the same reason. A payment gateway is the last
// place to add code you have not read.
//
// WHAT THIS MODULE IS AND IS NOT
// ------------------------------
// It is the boundary: it talks to Razorpay and it verifies signatures. It
// holds no opinion about orders, does not touch the database, and never
// decides that something is paid. That decision lives in markOrderPaid() in
// server.js and is deliberately one function, because "this order is paid" is
// the single most dangerous sentence in the system and it should be written
// down exactly once.
//
// THE THREE SECRETS, WHICH ARE NOT EQUALLY SECRET
// -----------------------------------------------
//   RAZORPAY_KEY_ID          public by design. It is handed to the browser so
//                            checkout.js can open the modal. Not a secret, and
//                            treating it as one leads people to hide it in
//                            ways that break test/live switching.
//   RAZORPAY_KEY_SECRET      server only. Authenticates API calls and signs
//                            the checkout callback.
//   RAZORPAY_WEBHOOK_SECRET  server only, and SEPARATE. You invent this value
//                            yourself when adding the webhook in the Razorpay
//                            dashboard — it is not issued to you, which is the
//                            detail people most often miss. It signs webhook
//                            deliveries and nothing else.
//
// The last two never leave this process. Nothing in this file logs them, and
// nothing returns them to a caller.
// =============================================================================

const crypto = require('crypto');

const API_BASE = 'https://api.razorpay.com/v1';

// Razorpay is a synchronous dependency of placing an order, so a hung
// connection would hold a checkout request open until the browser gave up.
// Ten seconds is generous for a JSON round trip and short enough that the
// customer gets a real answer.
const REQUEST_TIMEOUT_MS = 10000;

const keyId = () => (process.env.RAZORPAY_KEY_ID || '').trim();
const keySecret = () => (process.env.RAZORPAY_KEY_SECRET || '').trim();
const webhookSecret = () => (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

/** Every secret present. Checked at boot, not per request — see assertBootConfig. */
const isConfigured = () => Boolean(keyId() && keySecret() && webhookSecret());

/**
 * Rupees to integer paise.
 *
 * The one arithmetic rule in the whole integration. Razorpay compares amounts
 * exactly, and `orders.net_amount` is double precision — so this is the last
 * point at which a float is allowed to exist. Everything downstream compares
 * integers, because a tolerance in a payment check is a hole with a threshold:
 * whatever slack is allowed is exactly how much someone may underpay.
 */
function toPaise(rupees) {
    const amount = Number(rupees);
    if (!Number.isFinite(amount) || amount < 0) return null;

    // Number.EPSILON for the same reason round2() in server.js carries it:
    // 66000.485 * 100 is not 6600048.5 in binary floating point, and rounding
    // the wrong way once is a rupee that never reconciles.
    return Math.round((amount + Number.EPSILON) * 100);
}

/**
 * A boot-time refusal rather than a runtime surprise.
 *
 * Two failure modes, both silent and both expensive:
 *
 *   Missing secrets while payments are meant to be on. The process would
 *   start, take orders, and never charge for any of them. There is no
 *   degraded mode worth having here — an unpaid order that believes it is
 *   paid is worse than a site that will not boot.
 *
 *   Test keys in production, or live keys outside it. The first means every
 *   order is free and nobody notices until the settlement report is empty;
 *   the second means somebody is genuinely charged during a demo. Razorpay
 *   prefixes the key id for exactly this, so the check costs nothing.
 *
 * Throws. server.js calls it during boot, where a throw is the correct
 * response to a misconfiguration.
 */
function assertBootConfig() {
    const missing = [];
    if (!keyId()) missing.push('RAZORPAY_KEY_ID');
    if (!keySecret()) missing.push('RAZORPAY_KEY_SECRET');
    if (!webhookSecret()) missing.push('RAZORPAY_WEBHOOK_SECRET');

    if (missing.length) {
        throw new Error(
            `PAYMENTS_ENABLED is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. ` +
            `Refusing to start: the alternative is a storefront that takes orders it cannot charge for.`
        );
    }

    const id = keyId();
    const isTestKey = id.startsWith('rzp_test_');
    const isLiveKey = id.startsWith('rzp_live_');

    if (!isTestKey && !isLiveKey) {
        throw new Error(
            `RAZORPAY_KEY_ID does not look like a Razorpay key id (expected rzp_test_… or rzp_live_…). Refusing to start.`
        );
    }

    if (process.env.NODE_ENV === 'production' && isTestKey) {
        throw new Error(
            `RAZORPAY_KEY_ID is a TEST key and NODE_ENV is production. Every order would be free. Refusing to start.`
        );
    }

    if (process.env.NODE_ENV !== 'production' && isLiveKey) {
        throw new Error(
            `RAZORPAY_KEY_ID is a LIVE key outside production. Real customers would be charged by a development server. Refusing to start.`
        );
    }

    return { mode: isTestKey ? 'test' : 'live', keyId: id };
}

// ---- Signature verification -------------------------------------------------

/**
 * Constant-time hex comparison.
 *
 * timingSafeEqual rather than ===, the same reasoning as totp.js's verify():
 * a string compare returns as soon as it finds a difference, so how long it
 * takes leaks how many leading characters were right. It also throws on a
 * length mismatch, so the lengths are checked first — and an attacker learning
 * that a hex digest is 64 characters long has learned nothing.
 */
function safeEqualHex(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
}

const hmacHex = (secret, payload) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

/**
 * The signature Razorpay's checkout handler hands back to the browser.
 *
 * HMAC-SHA256 of "<order_id>|<payment_id>" keyed with the API secret.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * --------------------------------------
 * It proves Razorpay issued that payment against that Razorpay order. It says
 * NOTHING about which of our orders it belongs to — and that gap is the attack
 * every "I verified the signature" integration still has open:
 *
 *   Pay 1 rupee for a spare part. Keep the three strings. Place a 5-lakh
 *   order, close the modal, and post the 1-rupee payment's ids and signature
 *   against it. This function returns TRUE, correctly, because the signature
 *   is genuine.
 *
 * What refuses it is the caller comparing `orderId` against the
 * gateway_order_id stored on that order's own payments row, and the amount
 * against that row's amount_paise. Both checks live in server.js's verify
 * route. This function is one of four conditions, never the only one.
 */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
    if (!orderId || !paymentId || !signature) return false;
    return safeEqualHex(hmacHex(keySecret(), `${orderId}|${paymentId}`), signature);
}

/**
 * The signature on a webhook delivery.
 *
 * HMAC-SHA256 of the RAW REQUEST BODY, keyed with the webhook secret — which
 * is a different secret from the API one above.
 *
 * `rawBody` MUST be the exact bytes that arrived. Razorpay signs what it sent;
 * JSON.stringify(req.body) is not that — key order and whitespace differ after
 * a parse/serialise round trip, so re-serialising produces a digest that never
 * matches. The failure mode is what makes this worth a paragraph: the check
 * fails on every delivery, the developer is under pressure with a working
 * payment in the dashboard, and the fastest way out is to comment out the
 * verification. Then anyone who guesses the endpoint can post a captured-
 * payment event for any order they like.
 *
 * server.js captures the bytes with express.json's `verify` hook for this.
 */
function verifyWebhookSignature(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || !signature) return false;
    return safeEqualHex(hmacHex(webhookSecret(), rawBody), signature);
}

// ---- API calls --------------------------------------------------------------

async function apiRequest(method, path, body) {
    const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');

    let response;
    try {
        response = await fetch(API_BASE + path, {
            method,
            headers: {
                Authorization: 'Basic ' + auth,
                'Content-Type': 'application/json'
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        // Network, DNS or timeout. Deliberately not folded in with a Razorpay
        // error response below: "we could not reach the gateway" and "the
        // gateway said no" call for different handling upstream.
        const wrapped = new Error(`Could not reach Razorpay: ${error.message}`);
        wrapped.unreachable = true;
        throw wrapped;
    }

    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = null; }

    if (!response.ok) {
        const description = payload && payload.error && payload.error.description;
        const wrapped = new Error(`Razorpay ${method} ${path} failed (${response.status}): ${description || text.slice(0, 200)}`);
        wrapped.status = response.status;
        // The gateway's own machine-readable reason, where it gave one. Never
        // shown to a customer — it names internals — but worth logging.
        wrapped.gatewayCode = payload && payload.error && payload.error.code;
        throw wrapped;
    }

    return payload;
}

/**
 * Create the Razorpay order the customer will pay against.
 *
 * `amountPaise` must come from the order row already written to the database,
 * never from a request body. That ordering is the whole reason the checkout
 * route writes the order first: an amount taken from the client is an amount
 * the client chooses.
 *
 * payment_capture: 1 asks Razorpay to capture immediately rather than leaving
 * the payment merely authorised. An authorised-but-uncaptured payment is
 * auto-refunded after five days, which presents as "the customer paid and then
 * mysteriously did not".
 */
async function createOrder({ amountPaise, currency, receipt, notes }) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
        throw new Error(`createOrder needs a positive integer amount in paise, got ${amountPaise}`);
    }

    return apiRequest('POST', '/orders', {
        amount: amountPaise,
        currency: currency || 'INR',
        receipt: receipt,
        payment_capture: 1,
        // Notes come back to the client in the checkout response, so this
        // carries an internal id and nothing about the customer.
        notes: notes || {}
    });
}

/**
 * Read a payment straight from Razorpay.
 *
 * This is the call that makes verification mean anything. The browser's report
 * of a successful payment is a claim made over a channel the customer
 * controls; this is the same question asked over a channel they do not, on a
 * connection authenticated with a secret they do not have. The amount, the
 * currency, the status and the order id all come from here — never from the
 * request body — and are compared against what the database already froze.
 */
const fetchPayment = (paymentId) => apiRequest('GET', `/payments/${encodeURIComponent(paymentId)}`);

/**
 * A Razorpay order.
 *
 * Two callers, and they want different fields off it:
 *
 *   the webhook's order.paid event, which wants to know it exists
 *   POST /api/orders/:id/cancel, which wants `amount_paid`
 *
 * The second is the interesting one. A customer can be standing in the payment
 * modal in one tab while pressing Cancel in another, and our own payments row
 * is only as current as the last delivery we processed. `amount_paid` is the
 * question asked of the party that would know — over a connection the customer
 * cannot touch, which is the same reason markOrderPaid() re-fetches rather than
 * believing a signed webhook body.
 */
const fetchOrder = (orderId) => apiRequest('GET', `/orders/${encodeURIComponent(orderId)}`);

/**
 * Every payment the gateway saw in a window. For reconciliation only.
 *
 * WHY THIS IS A LIST AND NOT A LOOKUP
 * -----------------------------------
 * Every other call in this file starts from something this server already
 * knows about — an order it wrote, a payment id a caller presented. That makes
 * them all blind in the same direction: they can confirm what we have, and
 * they can never reveal what we are MISSING.
 *
 * The failure this exists to catch has no local record by definition. A
 * customer pays, the callback does not reach us (tab closed, app did not
 * switch back) and the webhook does not either (a stale tunnel URL, a bad
 * secret, an endpoint that answered 500 until Razorpay gave up). Money moved
 * and nothing in this database says so. Reading our own rows can never find it
 * — the only way is to ask the gateway what it has and diff.
 *
 * `from`/`to` are UNIX SECONDS, not milliseconds, and not ISO. Razorpay
 * silently returns an empty list for a timestamp in milliseconds rather than
 * rejecting it, which reads as "a quiet day" instead of "wrong units".
 *
 * `count` is capped at 100 by Razorpay, so callers page with `skip`.
 */
const listPayments = ({ from, to, count, skip }) => {
    const query = new URLSearchParams({
        from: String(from),
        to: String(to),
        count: String(Math.min(Number(count) || 100, 100)),
        skip: String(Number(skip) || 0)
    });
    return apiRequest('GET', `/payments?${query.toString()}`);
};

module.exports = {
    isConfigured,
    assertBootConfig,
    publicKeyId: keyId,
    toPaise,
    verifyCheckoutSignature,
    verifyWebhookSignature,
    createOrder,
    fetchPayment,
    fetchOrder,
    listPayments
};
