/*
 * src/main.js — the composition root
 * ============================================================================
 *
 * THE ONE FILE THAT KNOWS THE WHOLE APPLICATION EXISTS.
 *
 * Nothing else here registers itself as a side effect of being required.
 * Every middleware in core/ and every module under modules/ exports a function
 * that RETURNS something — a handler, a router — and this file is where those
 * are put in order. That is the difference between an application you can read
 * top to bottom and one you have to reconstruct by grepping for `app.use`.
 *
 * MIDDLEWARE ORDER IS BEHAVIOUR, NOT STYLE, and this order is the one `#1`
 * ran in, statement for statement. Three places in it are load-bearing:
 *
 *   trust proxy FIRST, before anything reads `req.ip` — every rate limiter in
 *   every module keys on it, and a limiter that runs before the setting is
 *   applied is a limiter counting the wrong thing.
 *
 *   the body parsers BEFORE the session and before any route, because the
 *   JSON parser's `verify` hook is what captures the raw bytes Razorpay signs.
 *   That hook is the webhook's entire security model and it cannot be added
 *   later in the chain.
 *
 *   the legal route BEFORE the static mounts. It answers six URLs that have no
 *   file behind them; the static handler would 404 them first.
 *
 * WHY THE MODULES ARE LISTED IN THIS ORDER. It is the order their routes were
 * declared in `#1`. No two of them claim the same path, so the order is not
 * load-bearing today — it is kept identical so that a behaviour difference, if
 * one is ever found, cannot be blamed on registration order.
 */
const express = require('express');

// ---- core: the application's own settings and infrastructure ---------------
const { applyAppSettings } = require('./core/config/app-settings');
const { assertBootConfig } = require('./core/config/boot');
const { corsMiddleware } = require('./core/http/cors');
const { csrfOriginGuard } = require('./core/http/csrf');
const { securityHeaders } = require('./core/http/security-headers');
const { jsonBodyParser, formBodyParser } = require('./core/http/body-parsing');
const { sessionMiddleware } = require('./core/http/session');
const { privatePathGuard } = require('./core/http/private-paths');
const { mountStaticFiles } = require('./core/http/static-files');
const { apiNotFound } = require('./core/http/not-found');
const { finalErrorHandler } = require('./core/http/error-handling');
const { healthRouter } = require('./core/health/probes');

// ---- modules: one bounded context each ------------------------------------
const { legalModule } = require('./modules/legal/legal.module');
const { enquiriesModule } = require('./modules/enquiries/enquiries.module');
const { quotesModule } = require('./modules/quotes/quotes.module');
const { projectsModule } = require('./modules/projects/projects.module');
const { categoriesModule } = require('./modules/categories/categories.module');
const { productsModule } = require('./modules/products/products.module');
const { ordersModule } = require('./modules/orders/orders.module');
const { authModule } = require('./modules/auth/auth.module');
const { cartModule } = require('./modules/cart/cart.module');
const { checkoutModule } = require('./modules/checkout/checkout.module');
const { paymentsModule } = require('./modules/payments/payments.module');

/**
 * Builds the application without starting it, so a test can hold an app it
 * never listens on.
 *
 * @returns {import('express').Express}
 */
function createApp() {
    const app = express();

    applyAppSettings(app);

    // ---- request pipeline, in the order a request meets it -----------------
    app.use(corsMiddleware);
    app.use(csrfOriginGuard);
    app.use(securityHeaders);
    app.use(jsonBodyParser);
    app.use(formBodyParser);
    app.use(sessionMiddleware);
    app.use(privatePathGuard);

    // Before the static mounts so a probe is never a filesystem lookup, and
    // outside /api so the default-deny at the bottom does not claim it.
    app.use('/health', healthRouter());

    // Six URLs, one template, no files. Must precede the static mounts.
    app.use(legalModule());

    // The frontend. Everything below this line is API.
    mountStaticFiles(app);

    // ---- the modules -------------------------------------------------------
    app.use(enquiriesModule());
    app.use(quotesModule());
    app.use(projectsModule());
    app.use(categoriesModule());
    app.use(productsModule());
    app.use(ordersModule());
    app.use(authModule());
    app.use(cartModule());
    app.use(checkoutModule());
    app.use(paymentsModule());

    // Registered after every module, so it only ever sees what nothing claimed.
    app.use('/api', apiNotFound);

    // S01/F10: the one place an uncaught error becomes a response, for every
    // route above. Last in the chain — Express only ever calls a 4-argument
    // handler like this one when something upstream threw or called
    // next(error) — and shared by both entry points because it lives here
    // rather than in server.js or the Vercel adapter.
    app.use(finalErrorHandler);

    return app;
}

/**
 * Builds the application and starts listening.
 *
 * The gateway assertion runs HERE rather than as a side effect of requiring
 * core/config/payments.js, so that an operator script or a test can import the
 * gateway configuration without a misconfigured environment killing the
 * process during a `require`.
 *
 * @returns {import('http').Server}
 */
function start() {
    assertBootConfig();

    const app = createApp();
    const PORT = process.env.PORT || 3000;
    return app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = { createApp, start };
