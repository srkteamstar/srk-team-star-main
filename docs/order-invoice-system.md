# Customer purchase invoice system

The storefront now creates a formal purchase invoice for every successfully
created order. The same document opens from the checkout confirmation and from
My Orders, and the browser can print it or save it as PDF.

## What is frozen at checkout

Migration `030_order_invoice_snapshots.sql` extends the existing atomic
`create_store_order` transaction. Alongside the order, line items, delivery
address and initial payment row, it now stores:

- a unique invoice number and issue time;
- currency, GST rate, intra/inter-state tax treatment and place of supply;
- buyer name, company, email and phone;
- seller legal/trade identity, GSTIN, address and contact details.

Product descriptions, unit prices, quantities and line totals already live in
`order_items`; subtotal, delivery, GST and grand total already live in
`orders`; the delivery address already lives in
`order_shipping_address`. The invoice reads those records and never reads live
catalogue prices or the customer's current profile.

Migration `031_guest_checkout.sql` then makes `orders.user_id` nullable and
adds a hashed, random access token for guest-owned orders. Guest contact data
continues to use the same immutable buyer snapshot; no `user_profiles` or
`shipping_addresses` row is created.

Existing orders are intentionally not rewritten by the migration. Their frozen
line, monetary and delivery records still produce an invoice, while any buyer
identity field that did not exist at order time is shown as not captured. The
API marks this with `snapshot.complete: false`.

## Invoice numbering

New records use `INV-YYYYMMDD-NNNNNN`, generated inside the same PostgreSQL
transaction after `orders.order_number` exists. The value is stored on the
order and protected by a unique partial index. Older rows with no stored
invoice number receive a deterministic display reference from their creation
date and order sequence.

## API and access control

`GET /api/orders/:id/invoice` accepts either a customer session or the random
one-order token returned by guest checkout. Account lookups include both `id`
and the signed-in customer's `user_id`; guest lookups compare only the stored
SHA-256 token hash. A mismatched token, another customer's id and an unknown id
all return 404; a signed-out request with no token returns 401. The token is
sent in a request header, never in a URL. There is no administrator exception
because this repository is the storefront and deliberately exposes no
privileged routes.

The response uses `Cache-Control: no-store`. Payment status and gateway
metadata are read from the latest payment row each time, so Refresh status can
show a webhook-confirmed payment without changing the frozen commercial
details.

## Tax and totals

The applicable GST rate is shown on each product row, while the totals section
shows one combined GST amount rather than separate CGST, SGST or IGST rows.
The underlying tax treatment remains frozen on the order for accounting.
Transportation is included in taxable value when charged, matching checkout.
Every displayed summary amount comes from the persisted order totals. Product
rows carry their allocated GST for readability; the authoritative GST and
grand total are the stored order-level values.

The current schema does not snapshot SKU/HSN, per-line discount, buyer GSTIN or
a separate billing address. The invoice does not invent them. Until checkout
collects a distinct billing address, the frozen delivery address is labelled
Bill to / Ship to.

## Print layout

The screen view is a spacious full-page viewer with two actions: Refresh
status and Print / Save PDF. Print media removes all website and overlay chrome,
sets A4 paper, repeats table headings, prevents item rows and totals from
splitting where possible, and keeps the payment bar, parties and sign-off
together.

## Deployment

1. Apply migrations through `030_order_invoice_snapshots.sql` in numeric order.
2. Restart the backend so the checkout controller and invoice route load.
3. Rebuild the committed stylesheet with `npm run build:css`.
4. Run `npm run test:all`.

The seller contract uses the 15-character GSTIN already published by the site:
`06DOCPR1264G1Z0`. The separately supplied value `06DOCPR1264G11Z0` contains
16 characters and was not placed on a legal invoice without confirmation.
