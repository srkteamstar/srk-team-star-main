/*
 * core/config/app-settings.js — the two settings the Express app itself takes
 * ============================================================================
 *
 * Applied before any middleware, because `trust proxy` changes what `req.ip`
 * means and every rate limiter in every module keys on it.
 */

/**
 * @param {import('express').Express} app
 */
function applyAppSettings(app) {
    // TRUST PROXY — off unless the deployment actually has one in front.
    //
    // `app.set('trust proxy', 1)` was unconditional, and with nothing proxying
    // this process that is not a no-op: it tells Express to believe the last
    // entry of X-Forwarded-For, a header the client writes. Verified against this
    // server — a request carrying `X-Forwarded-For: 5.5.5.5` reported req.ip as
    // 5.5.5.5. Every rate limiter keys on req.ip, so one header per request gave
    // each attempt a fresh bucket, and authLimiter — described in its own comment
    // as "the only thing between a script and walking the customer list by trying
    // addresses until one resolves" — counted to 20 and never got there.
    //
    // So it is opt-in via TRUST_PROXY, and only for a deployment that really does
    // sit behind one. Behind no proxy the socket address is the only honest
    // source of the client IP; behind one, set TRUST_PROXY to the number of hops
    // you control (usually 1). Erring in the safe direction costs nothing but a
    // shared bucket for everyone behind the same NAT. Erring the other way
    // removes rate limiting altogether.
    const TRUST_PROXY = process.env.TRUST_PROXY;
    if (TRUST_PROXY) {
        app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
    } else {
        app.set('trust proxy', false);
    }

    // Version fingerprinting for free on every response. Nothing reads it.
    app.disable('x-powered-by');
}

module.exports = { applyAppSettings };
