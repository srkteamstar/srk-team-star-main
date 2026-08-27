/*
 * shared/contracts/order-reference.js - the number a customer quotes back
 * ============================================================================
 *
 * ONE FUNCTION REPLACING THREE COPIES. This string was built inline in three
 * places in the old server.js - the customer's order history, the checkout
 * response, and the payment verification response - each with its own copy of
 * the same two lines. Every one of them produced the identical text, which is
 * the good case; the bad case is the day one of them is corrected and the
 * customer is shown two different references for one order.
 *
 * Output is byte-identical to what all three produced: ORD-<year>-<number>,
 * with the year taken from the order's own created_at rather than from "now",
 * so an old order reads the same next year as it did the day it was placed.
 * That is the same rule modules/quotes uses for its PI- reference.
 */
function orderReference(order) {
    const year = order && order.created_at ? new Date(order.created_at).getFullYear() : new Date().getFullYear();
    return `ORD-${year}-${order ? order.order_number : ''}`;
}

module.exports = { orderReference };
