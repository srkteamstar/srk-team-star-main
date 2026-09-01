/*
 * shared/contracts/payment.js — the payment vocabulary and the offline instruments
 * ============================================================================
 *
 * Shared for the same reason order-status.js is: modules/checkout writes a
 * payment row, modules/payments settles it, and modules/orders reports it to
 * the customer. The statuses are the one thing all three have to spell
 * identically.
 *
 * PAYMENT_METHODS lives here rather than in checkout because it is PUBLISHED —
 * `POST /api/checkout/summary` returns it so the browser renders the picker
 * from the same list the server validates against. It used to be typed out in
 * both server.js and checkout-module.js under a comment asking whoever edited
 * one to remember the other, and that drift fails silently in the expensive
 * direction: a method the page offers and the server does not know is accepted,
 * posted, and rewritten to PAYMENT_METHODS[0]. The customer picks one thing and
 * the invoice says another.
 */
const CURRENCY = 'INR';

// Statuses this file writes. Named rather than inline so the vocabulary and
// migration 014's check constraint cannot drift apart in a typo.
const PAYMENT_STATUS = {
    created: 'Created',   // a Razorpay order exists, nobody has paid yet
    pending: 'Pending',   // offline, awaiting the sales team
    paid: 'Paid',         // captured AND verified against the gateway
    failed: 'Failed',
    partiallyRefunded: 'Partially Refunded', // refund.processed, for less than the full amount — see migration 034
    refunded: 'Refunded'                     // refund.processed, in full — see migration 034
};

// How the customer intends to settle when paying OFFLINE. An unrecognised or
// missing value falls back to the first entry rather than failing the whole
// order over a cosmetic field.
//
// THERE IS EXACTLY ONE OF THESE, AND THAT IS THE POINT.
//
// This list used to carry four: Bank Transfer, UPI, Cheque and Cash on
// Delivery. Three of them were the same promise wearing different clothes —
// "we will settle this between us later" — and each one asked the customer a
// question the site could not act on. A Bank Transfer row does not move money;
// an offline "UPI" is a *claim* that a UPI payment was made, sitting on the
// same page as the gateway's real one; a Cheque row is a note to the sales
// team. The customer's actual decision was only ever binary: pay now, or pay
// when the machine arrives.
//
// So the choice is now that binary, and the two halves are carried by
// different fields — `payment_mode` says pay-now versus pay-later (see
// PAYMENT_MODES below), and this list holds the single instrument the later
// half means. UPI, cards and EMI did not disappear; they moved to where they
// are real, behind the gateway, where the instrument is REPORTED by Razorpay
// at capture instead of guessed here.
//
// Historic orders keep whatever they were written with. `payments.payment_method`
// has no check constraint (migration 014 constrains `gateway` and `status`,
// not this), so a 2024 order still reads 'Cheque' in the admin table and on
// its invoice, which is the truth about that order.
//
// This stays what it always was — a stated intention, never a claim that money
// moved. When the customer pays through Razorpay, this list is not consulted
// at all.
const PAYMENT_METHODS = ['Cash on Delivery'];

// HOW THE CUSTOMER CHOSE TO SETTLE, which is a different question from the
// instrument above and is the one that decides whether a gateway is involved
// at all.
//
// This used to be decided by PAYMENTS_ENABLED alone: gateway on meant every
// order went through Razorpay and the offline methods were not offered. That
// is wrong for this business — paying on receipt is an ordinary way to buy
// industrial machinery, and taking it away the moment card payments were
// switched on would have removed a real option rather than added one.
//
// So the two are now independent:
//
//   PAYMENTS_ENABLED   whether paying online is POSSIBLE at all (deployment)
//   payment_mode       whether this customer chose to (per order)
//
// The server is the authority on both. A body asking for 'online' when the
// gateway is off is answered with the offline flow rather than an error: it
// is a stale client, the order is still perfectly placeable, and failing it
// would be failing a customer over our configuration.
const PAYMENT_MODES = ['online', 'offline'];

module.exports = { CURRENCY, PAYMENT_STATUS, PAYMENT_METHODS, PAYMENT_MODES };
