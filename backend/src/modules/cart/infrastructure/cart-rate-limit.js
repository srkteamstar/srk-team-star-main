/*
 * modules/cart/infrastructure/cart-rate-limit.js
 * ============================================================================
 */
const rateLimit = require('express-rate-limit');

// ==========================================

// One counter per IP per instance, so these are two instances and not one
// shared between them — the formLimiter / quoteLimiter split, same reasoning.
// A read happens about once per page load. A write happens on a debounce
// after quantity changes, so its budget is the looser of the two.
//
// A refused write is recoverable and close to invisible, which is a property
// of the shape rather than luck: every PUT carries the *complete* cart, so a
// 429 is not a lost line — it is one skipped snapshot, and the next write
// that lands says everything the refused one would have.
const cartReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: { error: "Too many requests. Try again in a few minutes." }
});

const cartWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: "Too many cart updates. Try again in a few minutes." }
});


module.exports = { cartReadLimiter, cartWriteLimiter };
