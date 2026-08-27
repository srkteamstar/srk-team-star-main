/*
 * core/config/payments.js — is the gateway on, and does it boot
 * ============================================================================
 *
 * The FLAG lives in core/config because it is a deployment setting and because
 * three modules read it: checkout decides whether to create a gateway order,
 * payments refuses its two routes with a 404 when it is off, and orders only
 * offers a customer a "pay now" handshake when it is on.
 *
 * The BOOT ASSERTION lives here too, as `assertGatewayBootConfig()` that
 * main.js calls explicitly rather than as a side effect of requiring this
 * file. That matters: `#1` ran the check as a top-level statement, so the
 * process died during a `require`, and a require that can kill the process is
 * a require nothing can safely make from an operator script or a test.
 */
// ---- The gateway -----------------------------------------------------------
//
// OFF BY DEFAULT, AND LOUD WHEN ON.
//
// The two ways to get this wrong are opposites, and both are silent:
//
//   Require keys unconditionally, and a deployment that has not got them yet
//   simply will not boot — including this one, today.
//
//   Fall back to the offline flow whenever keys are absent, and a production
//   deploy whose environment failed to load quietly stops charging anybody.
//   Every order still succeeds. Nobody finds out until the settlement report
//   is empty.
//
// So the switch is explicit and separate from the secrets. PAYMENTS_ENABLED
// unset means the offline flow runs exactly as it did before this existed.
// PAYMENTS_ENABLED set means the secrets MUST be present and MUST match the
// environment, or the process refuses to start — see assertBootConfig() in
// core/gateways/razorpay.js. There is no third state where it half-works.
const razorpay = require('../gateways/razorpay');

const PAYMENTS_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_ENABLED || '').trim());

/**
 * Called once by main.js, after the config is loaded and before any route can
 * take money. Refuses to return on a misconfigured deployment — see the
 * comment above for why there is no third, half-working state.
 */
function assertGatewayBootConfig() {
    if (PAYMENTS_ENABLED) {
        const { mode } = razorpay.assertBootConfig();
        console.log(`Payments: Razorpay ENABLED in ${mode} mode.`);
    } else {
        console.log('Payments: Razorpay disabled (PAYMENTS_ENABLED unset). Orders are recorded for offline settlement.');
    }
}

module.exports = { PAYMENTS_ENABLED, assertGatewayBootConfig };
