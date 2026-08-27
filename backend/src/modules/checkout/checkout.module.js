/*
 * modules/checkout/checkout.module.js - the module registration file
 * ============================================================================
 *
 *
 * THE CLIENT NEVER NAMES A PRICE
 * ------------------------------
 * The cart lives in the browser — sessionStorage for a guest, and for a
 * signed-in customer a cart_items table this server fills from what that
 * browser told it. Either way the customer can edit it, and the snapshot
 * prices in cart_items are the browser's claims rather than this server's
 * findings. So the browser sends nothing but product ids and quantities to
 * the routes below, nothing above is consulted for an amount, and every figure
 * on the checkout page — unit price, line total, GST, delivery, the amount
 * finally written to `orders` — is computed here from the `products` table.
 * POST /api/checkout/summary exists so the page can *display* those numbers
 * without ever being the authority on them: it runs the identical
 * priceCheckout() the placing route runs, so what is shown and what is
 * charged cannot drift.
 *
 * PAYMENT, AND THE ONE RULE THAT SURVIVES ADDING A GATEWAY
 * --------------------------------------------------------
 * This block used to say "there is no gateway and no key", and that is no
 * longer true — Razorpay is wired in below, behind PAYMENTS_ENABLED. What it
 * also said is still true and is now load-bearing rather than aspirational:
 *
 *     A callback from the client is not proof that money moved.
 *
 * Razorpay's checkout hands the browser three strings and the browser posts
 * them back here. That is a claim, made over a channel the customer controls.
 * It is believed only after the server has asked Razorpay the same question
 * over a channel the customer does not control, and only after the answer has
 * been matched against an amount this server froze before the customer ever
 * saw the modal.
 *
 * markOrderPaid() below is the only code in this file that writes
 * payments.status = 'Paid'. Both the browser callback and the webhook route
 * call it; neither is trusted to do the work itself. If a third path ever
 * needs to mark an order paid, it calls that function too — it does not grow
 * its own copy.
 *
 * WHAT THIS MODULE OWNS
 *   the act of turning a basket into an order. It writes orders, order_items,
 *   order_shipping_address and the initial payments row - all four inside
 *   create_store_order() - and then hands off.
 *
 *   POST /api/checkout/summary   anonymous, a read, budgeted generously
 *   POST /api/checkout           anonymous, writes five rows, budgeted tightly
 *
 * WHAT IT IMPORTS FROM SIBLINGS, all through published interfaces:
 *   products.public -> findActiveProductsByIds   the catalogue it prices from
 *   auth.public     -> the guest-checkout account and the session it opens
 *
 * The auth edge is the one WRITE crossing a module boundary in this codebase
 * (startSession). It stays a synchronous call rather than an event because the
 * customer has to be signed in by the time this response is written, and it is
 * recorded as a deliberate deviation in ARCHITECTURE.md.
 */
const express = require('express');
const { checkoutController } = require('./controllers/checkout.controller');

/** @returns {import('express').Router} */
function checkoutModule() {
    const router = express.Router();
    router.use(checkoutController());
    return router;
}

module.exports = { checkoutModule };
