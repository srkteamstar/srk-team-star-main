# Quotation request system

## What this application owns

This storefront collects and prices customer quotation requests. It does not
issue staff-approved quotations. The administration console remains the place
for approval, validity dates, negotiated discounts, payment terms, signatures,
and conversion to an order.

The printable storefront document is therefore labelled **Request
Acknowledgement**. It is suitable for printing or saving as PDF, but it states
that it is not an accepted order or final quotation.

## Data flow

```text
Product selection / quantity
        |
        | 350 ms debounce; ids + quantities only
        v
POST /api/quote-requests/calculate
        |
        | products_with_image (server-side catalogue read)
        v
Authoritative names, categories, prices, GST and totals
        |
        | rendered into the live preview
        v
POST /api/quote-requests
        |
        | calculates again to avoid a stale preview
        v
create_quote_request(...) PostgreSQL transaction
        |
        v
Immutable request header + item snapshots + PI reference
```

## Calculation endpoint

`POST /api/quote-requests/calculate`

Request:

```json
{
  "items": [
    { "product_id": 1, "quantity": 2 }
  ]
}
```

The endpoint ignores any extra browser-provided names, prices, discounts, tax
rates, or totals. Product ids must be positive integers, quantities must be
integers from 1 through 99, and a request may contain at most 50 lines.

The response supplies:

- authoritative product and category identity;
- unit price, taxable value, GST amount, and line total where a numeric price
  exists;
- `pricing_status: "on_request"` and null monetary fields where it does not;
- priced subtotal, GST, estimated total, and explicit unpriced/unavailable
  counts;
- `EX-WORKS` commercial basis with delivery excluded;
- a calculation version and timestamp.

No grand total is returned while one or more lines are priced on request. This
prevents a partial total from looking like a complete quotation.

## Finalisation endpoint

`POST /api/quote-requests` accepts the customer contact fields plus the same
minimal item list. It recalculates from the live catalogue, then calls the
`create_quote_request(jsonb, jsonb)` database function introduced by migration
029. The function writes the header and all items in one PostgreSQL transaction.

During a deployment window where migrations 009 and 026 exist but 029 has not
yet been applied, the server recognises PostgREST's exact `PGRST202` missing-
function response and uses those established table columns as a compatibility
write. It deletes the header if child insertion fails. This keeps customer
requests working during rollout; applying 029 remains required because that is
the fully atomic write and the complete commercial snapshot.

The response includes the historical `PI-<year>-<id>` reference and the saved
snapshot used by the confirmation and print views. The prefix is retained for
compatibility with existing records; the document title makes clear that the
result is a request acknowledgement.

Migration 029 prevents commercial/customer snapshot fields and item rows from
being edited after creation. Staff may still advance the request status, which
is operational state rather than submitted history.

## Current commercial rules

- Currency: INR.
- GST: the running `GST_RATE` setting, currently defaulting to 18%.
- Discount: zero; there is no catalogue discount schema yet.
- Commercial basis: EX-WORKS.
- Delivery: excluded from the request estimate.
- A non-numeric catalogue price remains `On request`.
- A withdrawn or missing product blocks submission.

The product schema currently has no SKU/item-code, unit-of-measure, inventory,
MOQ, or tier-pricing fields. Those values are intentionally not invented. Add
them to the product domain and its published quote read port before enforcing
such rules in this service.

## Frontend behaviour

- Product and quantity changes trigger one debounced calculation request.
- A skeleton appears while pricing is updated.
- Per-line status and a compact aggregate preview update without replacing the
  form, so business/contact fields remain untouched.
- Network or validation failures appear inline with a retry action.
- Submission is disabled when the server reports an unavailable line.
- The server calculates again at submission even if the live preview succeeded.
- The confirmation contains a responsive screen preview and print-specific A4
  layout with brand logo, customer details, item table, totals, terms, GSTIN,
  and contact details.

## Deployment

1. Apply `backend/migrations/029_quote_pricing_snapshots.sql` after migration
   028. The new server route depends on its database function.
2. Confirm `GST_RATE` against the real commercial policy.
3. Restart the backend process.
4. Deploy the rebuilt `public/assets/vendor/tailwind.build.css` with the
   frontend JavaScript.
5. Run `npm run test:all` from `backend/`.

## Administration-console integration

The separate administration console should read the new snapshot columns from
the shared Supabase project. A later staff-issuance feature should create a
separate issued-quotation record and reference rather than changing the request
snapshot. That record is the correct home for negotiated discounts, validity,
bank details, signatures, revisions, and order conversion.
