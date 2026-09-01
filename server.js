/*
 * Vercel's Express entry point.
 *
 * The normal Node deployment still starts through backend/server.js. Vercel
 * looks for a root entry point that imports Express and exports the app rather
 * than holding a port open, so this file is a deliberately thin adapter over
 * the same composition root.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

// Vercel's Express detector requires the recognized entry point to import the
// framework directly. Application construction remains in backend/src/main.
const express = require('express');

if (typeof express !== 'function') {
    throw new Error('Express did not load.');
}

// S07: this used to call only assertGatewayBootConfig(). assertProductionConfig()
// — the HTTPS-origin and secret-strength checks — never ran on this path, so a
// synthetic Vercel environment with an insecure HTTP origin and a
// 32-character secret built the app anyway; the validator rejected it and
// nothing here was listening. assertBootConfig() is the one gate
// backend/src/main.js's start() runs too, so both entry points share it
// rather than each remembering its own subset. Run before main is even
// required, so a rejected configuration never reaches app construction.
const { assertBootConfig } = require('./backend/src/core/config/boot');
assertBootConfig();

const { createApp } = require('./backend/src/main');

// S01: createApp() registers the shared, redacted final error handler as its
// last middleware (backend/src/core/http/error-handling.js) — this used to
// duplicate that with a local `console.error(error)`, which is exactly the
// raw-object logging S01 exists to remove. One handler, defined once, used by
// both entry points.
const app = createApp();

module.exports = app;
