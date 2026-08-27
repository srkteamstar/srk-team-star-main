/*
 * modules/cart/cart.module.js - the module registration file
 * ============================================================================
 *
 *
 * WHY A CART IS SUDDENLY THE SERVER'S BUSINESS
 * --------------------------------------------
 * It was one localStorage key, `srk_cart`, with nothing in it naming an
 * owner. That is one basket per *browser*: sign in, fill it, sign out, and
 * the lines are still sitting there for whoever uses that machine next — or
 * for the second customer who signs in on it. A visitor who never signs in
 * left one behind that outlived their visit entirely, because localStorage
 * has no session to end.
 *
 * So a cart now has exactly one owner, and only one of the two lives here:
 *
 *   signed in   cart_items, keyed on user_id, reachable only through these
 *               two routes behind requireCustomer
 *   guest       sessionStorage in the browser, thrown away with the tab, and
 *               never sent here at all
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a price list and it is not an order. The snapshot columns are
 * echoes of catalogue rows the client already had, kept for the same reason
 * cart-module.js has always kept them: a withdrawn product must not make a
 * line vanish out from under somebody mid-basket. Every figure that decides
 * money is still computed by priceCheckout() from `products` at checkout
 * time, from ids and quantities alone. Nothing below is ever consulted for
 * an amount.
 *
 * AND IT IS NOT AUTHENTICATION EITHER
 * -----------------------------------
 * requireCustomer is the whole boundary, and sign-in still takes no
 * password — so whoever can type a customer's email can already read that
 * customer's order history and postal address, and can now read their cart
 * as well. That is a strictly smaller disclosure than what the account
 * already exposed. It is worth naming rather than leaving to be discovered.
 *
 * WHAT THIS MODULE OWNS
 *   the cart_items table (migration 017)
 *   GET /api/cart   requireCustomer
 *   PUT /api/cart   requireCustomer
 *
 * IT IS NOT A PRICE LIST. The snapshot columns are echoes of catalogue rows
 * the client already had, and nothing here is ever consulted for an amount:
 * modules/checkout prices every order from the products table, from ids and
 * quantities alone.
 */
const express = require('express');
const { cartController } = require('./controllers/cart.controller');

/** @returns {import('express').Router} */
function cartModule() {
    const router = express.Router();
    router.use(cartController());
    return router;
}

module.exports = { cartModule };
