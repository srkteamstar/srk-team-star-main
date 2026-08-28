/*
 * modules/orders/orders.module.js - the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the orders, order_items and order_shipping_address tables, as a RECORD.
 *   It reads them for two audiences and moves the status along exactly two
 *   edges - a customer's order history and a customer's cancel.
 *
 *   GET   /api/orders/mine         customer
 *   GET   /api/orders/:id/invoice  customer session or guest order token
 *   POST  /api/orders/:id/cancel   customer session or guest order token
 *
 * IT DOES NOT CREATE ORDERS. modules/checkout does, in one Postgres function
 * (migration 025's create_store_order), and modules/payments is what clears
 * 'Pending Payment' when money lands. Three modules touch the order lifecycle
 * and none of them owns all of it, which is precisely why the status
 * vocabulary lives in shared/contracts/order-status.js instead of here.
 *
 * WHAT IT IMPORTS FROM A SIBLING
 *   modules/payments/payments.public.js -> gatewayPaymentRow, and nothing
 *   else. A read, through the published interface. The reverse edge does not
 *   exist: payments never imports orders, which is what keeps the two out of
 *   an import cycle.
 */
const express = require('express');
const { customerOrdersController } = require('./controllers/customer-orders.controller');

/** @returns {import('express').Router} */
function ordersModule() {
    const router = express.Router();
    router.use(customerOrdersController());
    return router;
}

module.exports = { ordersModule };
