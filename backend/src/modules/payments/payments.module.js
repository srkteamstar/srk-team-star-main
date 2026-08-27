/*
 * modules/payments/payments.module.js - the module registration file
 * ============================================================================
 *
 *
 * THE BROWSER REPORTS INTENT. THE GATEWAY REPORTS MONEY.
 * -----------------------------------------------------
 * Two things tell this server a payment happened, and they are not equally
 * trustworthy:
 *
 *   The checkout callback. Razorpay's modal hands the browser an order id, a
 *   payment id and a signature, and the page posts them here. Fast, and the
 *   only way to show a confirmation while the customer is still looking at
 *   the screen — but it arrives over a channel the customer controls, and it
 *   does not arrive at all when a UPI app fails to switch back, when the tab
 *   is closed on the bank's page, or when a train enters a tunnel.
 *
 *   The webhook. Razorpay posts it server-to-server, signed with a secret the
 *   customer does not have, and retries until it gets a 2xx. Slower, and
 *   authoritative.
 *
 * So the webhook is the authority and the callback is a UX shortcut. Both
 * funnel into markOrderPaid(), which does not believe either of them: it asks
 * Razorpay directly and compares the answer with figures this server froze
 * before the customer ever saw the modal.
 *
 * WHAT THIS MODULE OWNS
 *   the payments and payment_events tables, and the Razorpay conversation
 *   POST /api/payments/verify      rate limited, gateway-only
 *   POST /api/webhooks/razorpay    NOT rate limited - see the limiter file
 *
 * REFUNDS ARE RECORDED, NEVER INITIATED. There is no browser-reachable refund
 * path and there must not be one; a refund is an action taken in the Razorpay
 * dashboard and refund.processed is how this ledger learns of it.
 */
const express = require('express');
const { paymentsController } = require('./controllers/payments.controller');

/** @returns {import('express').Router} */
function paymentsModule() {
    const router = express.Router();
    router.use(paymentsController());
    return router;
}

module.exports = { paymentsModule };
