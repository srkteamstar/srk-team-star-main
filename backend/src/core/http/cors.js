/*
 * core/http/cors.js — the origin allow list
 * ============================================================================
 *
 * Exports the list as well as the middleware, because core/http/csrf.js has to
 * agree with it: an origin this app is willing to answer with credentials is
 * the same origin it is willing to accept a state-changing request from, and
 * two copies of that list would drift.
 */
const cors = require('cors');

// ==========================================
// ORIGIN POLICY — an allow list, not a mirror
// ==========================================
//
// This was `cors({ origin: true, credentials: true })`, which does not mean
// "allow my own origin". `origin: true` REFLECTS whatever Origin the caller
// sent and pairs it with Access-Control-Allow-Credentials: true — verified
// against this server, which answered `Origin: https://evil.example` with
// `Access-Control-Allow-Origin: https://evil.example`. That is a standing
// instruction to every browser that any site on the internet may read this
// API's credentialed responses. SameSite=lax on the cookie is what kept it
// from being exploitable, which is one mistake away from being the whole
// story rather than the second line of it.
//
// The site is served by this same process, so the browser's own requests are
// same-origin and need no CORS grant at all. The allow list therefore starts
// EMPTY, and is populated from ALLOWED_ORIGINS only for a deployment that
// genuinely serves the frontend from somewhere else.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const corsMiddleware = cors({
    origin: (origin, callback) => {
        // No Origin header: same-origin navigations, curl, server-to-server.
        // Nothing is granted here — CORS only ever *adds* permission, and a
        // request with no Origin was never subject to it.
        if (!origin) return callback(null, false);
        callback(null, ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
    // PUT is here because PUT /api/cart exists. It is dead configuration
    // today — ALLOWED_ORIGINS is empty and this process serves the site, so
    // every call is same-origin and never preflighted — which is exactly why
    // it is worth keeping in step: the day somebody serves the frontend
    // elsewhere, a list that had drifted would fail the cart alone, with a
    // preflight error and every other route working.
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    // Guest invoice and cancellation requests carry their one-order bearer
    // token in this header. Without it, a split frontend/API deployment passes
    // ordinary checkout and then fails only when the guest returns to the order.
    allowedHeaders: ['Content-Type', 'X-Order-Access-Token'],
    maxAge: 600
});

module.exports = { ALLOWED_ORIGINS, corsMiddleware };
