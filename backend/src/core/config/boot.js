/*
 * core/config/boot.js — the one validation gate both entry points pass through
 * ============================================================================
 *
 * S07: backend/server.js -> src/main.js's start() ran assertProductionConfig()
 * and assertGatewayBootConfig(); the Vercel adapter at the repo root ran only
 * the second one. A synthetic Vercel environment with an insecure HTTP origin
 * and a 32-character secret built the app anyway, because nothing on that path
 * ever asked assertProductionConfig() what it thought.
 *
 * One function, called by both. Not a side effect of requiring this file —
 * same reasoning as the two checks it wraps: an operator script or a test can
 * still import config without a misconfigured environment killing the process
 * at require time.
 */
const { assertProductionConfig } = require('./runtime');
const { assertGatewayBootConfig } = require('./payments');

function assertBootConfig() {
    assertProductionConfig();
    assertGatewayBootConfig();
}

module.exports = { assertBootConfig };
