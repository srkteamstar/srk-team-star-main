// =============================================================================
// harness-control.js — the one thing the suites can tell the fake gateway
// =============================================================================
//
// WHY A FILE AND NOT A VARIABLE
// -----------------------------
// run.js SPAWNS the harness as its own process and then spawns each suite as
// another. The fake Razorpay lives inside the harness process; the tests live
// outside it. So a module-level Set shared by `require` is not shared at all —
// each process gets its own copy, and a test that mutates one is mutating an
// object the gateway will never look at. It would pass or fail for reasons
// unrelated to the assertion.
//
// Every other gateway answer avoids needing a channel at all, by encoding what
// it should say in the payment id the test names:
//
//     pay_<status>_<amountPaise>_<gatewayOrderId>
//
// That trick does not reach ONE case. POST /api/orders/:id/cancel asks the
// gateway `amount_paid` for a gateway order whose id was MINTED BY THE STUB —
// the test cannot name it in advance, only discover it afterwards. So the
// refusal that matters most on that route (money landed while the customer was
// pressing Cancel in another tab) needs the test to point at an order after the
// fact.
//
// Hence a tiny file, read fresh on every gateway call. No dependency, no
// server, no port, and both processes compute the same path from the same port
// number. Requiring this module has no side effects — importantly, it does NOT
// boot a server the way requiring authz-harness.js does.
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const controlPath = () =>
    path.join(os.tmpdir(), `srk-harness-gateway-${process.env.HARNESS_PORT || '3456'}.json`);

/** What the fake gateway should pretend, right now. Never throws. */
function read() {
    try {
        return JSON.parse(fs.readFileSync(controlPath(), 'utf8'));
    } catch (error) {
        // Absent, mid-write, or malformed. The default is "behave normally",
        // which is what every test that does not touch this file wants.
        return {};
    }
}

function write(state) {
    fs.writeFileSync(controlPath(), JSON.stringify(state || {}), 'utf8');
}

/** Report money against these gateway order ids. */
const setPaidOrders = (ids) => write({ paidOrders: ids || [] });

const failNextAtomicCheckout = () => {
    const state = read();
    state.failNextAtomicCheckout = true;
    write(state);
};

const failNextQuoteRpcMissing = () => {
    const state = read();
    state.failNextQuoteRpcMissing = true;
    write(state);
};

const failNextGatewayPaymentFetch = () => {
    const state = read();
    state.failNextGatewayPaymentFetch = true;
    write(state);
};

const consumeGatewayPaymentFetchFailure = () => {
    const state = read();
    if (!state.failNextGatewayPaymentFetch) return false;
    delete state.failNextGatewayPaymentFetch;
    write(state);
    return true;
};

const consumeQuoteRpcMissing = () => {
    const state = read();
    if (!state.failNextQuoteRpcMissing) return false;
    delete state.failNextQuoteRpcMissing;
    write(state);
    return true;
};

const consumeAtomicCheckoutFailure = () => {
    const state = read();
    if (!state.failNextAtomicCheckout) return false;
    delete state.failNextAtomicCheckout;
    write(state);
    return true;
};

const paidOrders = () => {
    const state = read();
    return Array.isArray(state.paidOrders) ? state.paidOrders : [];
};

const reset = () => write({});

module.exports = {
    controlPath, read, write, setPaidOrders, paidOrders,
    failNextAtomicCheckout, consumeAtomicCheckoutFailure,
    failNextQuoteRpcMissing, consumeQuoteRpcMissing,
    failNextGatewayPaymentFetch, consumeGatewayPaymentFetchFailure,
    reset
};
