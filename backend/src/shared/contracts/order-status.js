/*
 * shared/contracts/order-status.js — the fulfilment vocabulary
 * ============================================================================
 *
 * A SHARED CONTRACT, NOT A MODULE'S PRIVATE VOCABULARY, and deliberately so.
 *
 * Three modules must agree on these strings and none of them owns all three
 * transitions: modules/checkout WRITES the initial status, modules/payments
 * clears 'Pending Payment' when money lands, and modules/orders is the only
 * one that exposes the whole list for fulfilment. Parking the list in any
 * one of them would make the other two import a sibling's internals to read a
 * constant, and the import cycle that follows (orders needs payments, payments
 * needs orders) is precisely the failure the doctrine's barrel-file section
 * describes.
 *
 * So it sits where nothing owns it and everything may read it. It imports
 * nothing, which is what keeps that legitimate.
 *
 * The fulfilment vocabulary, and the whitelist PATCH /api/orders/:id/status
 * validates against. It must match migration 014's orders_status_check or a
 * legal-looking PATCH answers 500 from a constraint violation.
 *
 * 'Pending Payment' IS IN THIS LIST, AND WAS NOT BEFORE.
 *
 * It was omitted because no fulfilment action produces it — the checkout
 * route writes it and markOrderPaid() clears it. But leaving it out did not
 * make it unreachable, it made it *unrepresentable*: an order sitting in it
 * could be moved to any of the other four and never moved back, so one stray
 * click destroyed the only record that money was still owed. A status the
 * database can hold and the API cannot express is a one-way door.
 *
 * Whatever writes a status is expected to offer this one only on an order
 * already in it — round-trip capability, not a way to un-pay a paid order.
 */
const ORDER_STATUSES = ['Pending Payment', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

// The two members of that list this application's own code names, rather than
// reading back off a row. Named constants because a typo in a string literal
// here is an order that silently never leaves 'Pending Payment'.
const ORDER_STATUS_AWAITING_PAYMENT = 'Pending Payment';
const ORDER_STATUS_PLACED = 'Processing';

module.exports = { ORDER_STATUSES, ORDER_STATUS_AWAITING_PAYMENT, ORDER_STATUS_PLACED };
