/*
 * core/http/session.js — one cookie, two scopes
 * ============================================================================
 *
 * The `scope` a session carries is written by modules/auth and read by
 * core/security/guards.js. Nothing else may set it.
 */
const session = require('express-session');
const { isProduction } = require('../config/runtime');
const { SupabaseSessionStore } = require('./supabase-session-store');

// THE SESSION STORE
//
// MemoryStore is the express-session default, and it is what makes a server
// restart sign everybody out. That is a real cost on a storefront — a shopper
// mid-checkout has to sign in again after a deploy — but it is confined to
// local development below: production uses SupabaseSessionStore precisely
// because MemoryStore is process-local, and a deployment that runs more than
// one process (or replaces one on every request, as a serverless platform
// can) would otherwise have each instance holding its own private sessions —
// signing a customer out at random depending on which one answered. The cart
// a session protects is persisted against the account rather than the
// session either way, which is what makes the local-dev shortcut safe to take
// at all.
// A session secret is what makes the signed cookie unforgeable. Refusing to
// start is the only safe answer to its absence: the alternative is a process
// that looks healthy while issuing sessions anybody can mint.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('FATAL: SESSION_SECRET is missing or shorter than 32 characters. Refusing to start.');
    process.exit(1);
}

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    // A serverless deployment can move consecutive requests between isolated
    // processes. Production sessions therefore live in Postgres; local
    // development keeps the dependency-free MemoryStore for fast restarts.
    store: isProduction ? new SupabaseSessionStore() : undefined,
    // Named for the site rather than for a role. Nothing about a cookie name
    // should hint at what the session behind it may be entitled to.
    name: 'srk_sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // 'auto' rather than a NODE_ENV test. The old form meant a
        // deployment that simply forgot to set NODE_ENV=production shipped
        // the session cookie over plain HTTP, and nothing about the site
        // would look wrong while it did. 'auto' asks the connection instead
        // of an environment variable: secure over TLS, and still usable on a
        // plain-HTTP dev server, with no flag to forget in either direction.
        secure: 'auto',
        // 30 days. Credentials are checked when the session is opened; role
        // and suspension are still re-read on every protected request.
        maxAge: 30 * 24 * 60 * 60 * 1000
    },
    rolling: true
});

module.exports = { sessionMiddleware };
