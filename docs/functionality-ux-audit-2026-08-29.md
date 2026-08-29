# Storefront functionality and user-experience audit

**Website:** SRK Team Star storefront (`#2`)
**Audit date:** 29 August 2026
**Audit type:** non-destructive regression, link, responsive, accessibility-smoke, and dependency audit

## Executive result

No functional regression was found in the covered storefront journeys. The local application passes its structural, API, payment, and browser regression suites. All public, legal, and blog pages load successfully at mobile, tablet, and desktop widths, with no browser page errors or horizontal overflow in the automated smoke coverage.

This supports a **local application sign-off**. It is not by itself a production deployment sign-off: the two pending runtime migrations, production secrets, live payment test, alerting, and reconciliation checks remain deployment actions documented in the production-hardening report.

## Checks performed

| Area | Result |
|---|---|
| Route, link, and boot verification | Passed: 16 documents, 675 site-absolute references, 85 backend files, and the exact 24-route API surface |
| API/authentication and authorization | Passed: 82 assertions, 0 failures |
| Payment, webhook, cancellation, COD, and invoice flows | Passed: 58 assertions, 0 failures |
| Browser journeys | Passed: 65 tests, 0 failures |
| Responsive page smoke | 21 public/legal/blog routes × 4 viewport sizes; one heading, working skip target, no horizontal overflow, and no page errors |
| Stylesheet build and runtime application | Passed: Tailwind build completed and browser verified the compiled stylesheet and responsive classes |
| Dependency advisories | Passed from the local npm advisory cache: 0 known production vulnerabilities across 105 production dependencies. A live registry refresh was unavailable during the audit. |
| Whitespace/diff integrity | No content errors; Git reported only expected LF/CRLF normalization warnings |

## User journeys verified

- Product cards, product details, Buy Now, quiet add-to-cart, cart drawer, quantity changes, and checkout hand-off.
- Guest Cash on Delivery checkout, order reference, invoice display, and printable long invoices.
- Online-payment handshake behavior, payment-method selection, unpaid-order resume/cancel rules, and webhook retry behavior through the payment suite.
- Quote requests, including a cart handed to the quote form and a server-priced printable quote snapshot.
- Checkout draft persistence and payment-choice persistence after reload.
- Enquiry forms on the landing, contact, catalogue, store, and legal pages.
- Catalogue/store hash navigation, including malformed encoded fragments.
- Store home rows, View All filtering, featured slideshow, mobile gallery, blog category filtering, legal shell pages, map embeds, mobile navigation, overlay scroll locking, and keyboard access to product details.

## Findings

### No release-blocking breakages found

The automated evidence above found no broken local route, missing site asset, uncaught page exception, checkout dead-end, cart ownership regression, invoice mismatch, responsive overflow, or keyboard failure in the covered flows.

### Accepted scope exception: bundle/combinations UI

The store's static “Bought Together” bundle cards and their `View All` placeholder (`href="#"`) remain as previously requested. Their “Add Bundle” buttons are not connected to live product IDs. This is an intentional exception to the audit's otherwise-live storefront expectation and should be addressed only when real bundle/combinations data and pricing are approved.

### Low-priority hardening recommendation

The three homepage social links opened with `target="_blank"` do not currently include `rel="noopener noreferrer"` (the equivalent links on the other pages do). Modern browsers generally isolate these windows, but adding the relationship is still recommended for consistent reverse-tabnabbing protection.

### Maintenance warning

The CSS build reports that `caniuse-lite`/Browserslist data is outdated. This did not break the build or browser tests, but the dependency metadata should be refreshed during routine maintenance.

## Production sign-off conditions

Before declaring the live site fully signed off, complete the deployment-only items in [`production-hardening-report-2026-08-29.md`](production-hardening-report-2026-08-29.md): apply migrations 032 and 033 in order, configure and verify production Supabase/session/payment/alert settings, install reconciliation, reset the two locked legacy customer credentials, and run a real staging payment plus webhook redelivery and invoice/reconciliation verification.

## Audit conclusion

**Application functionality and responsive UX:** approved based on local automated evidence.
**Production deployment:** pending the external configuration and database actions above.
