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
const { createApp } = require('./backend/src/main');
const { assertGatewayBootConfig } = require('./backend/src/core/config/payments');

if (typeof express !== 'function') {
    throw new Error('Express did not load.');
}

assertGatewayBootConfig();

const app = createApp();

// Vercel recommends an explicit final error handler so a failed invocation is
// completed predictably and the function can be recycled safely.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    return res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
