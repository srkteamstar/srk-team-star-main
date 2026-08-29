# Production hardening report

**Website:** SRK Team Star storefront (`#2`)
**Review completed:** 29 August 2026
**Scope:** requested security fixes; migrations 020 and 025–031; storefront items 19–21; confirmed commercial terms and item 23; production configuration.

## Executive result

The requested application changes are complete and the full local verification suite passes. The storefront code is ready for a controlled production deployment, but final production sign-off must wait until the two new database migrations are applied and the deployment-only checklist at the end of this report is completed.

The existing bundle and combination-item presentation was deliberately left unchanged, as requested.

## Security fixes completed

1. **Production sessions now use shared Postgres storage.** Local development may still use in-memory sessions, but production and Vercel instances use `storefront_sessions`. This prevents random sign-outs and inconsistent authorization when requests move between serverless instances.

2. **Production rate limits now use shared Postgres counters.** Each route retains a separate security budget and every production instance sees the same counter. This closes the serverless bypass where requests distributed across instances receive fresh in-memory limits.

3. **Authorization now fails closed.** Missing, null, or unknown roles are rejected at sign-in, session checks, order access, and checkout. An absent role can no longer be interpreted as a customer.

4. **Anonymous and account input lengths are bounded.** Registration, login, profile, address, and guest-checkout fields are rejected before oversized values reach the database. This limits resource abuse and makes database behavior predictable.

5. **Payment webhooks are authenticated before storage.** Invalid signatures are rejected without creating database event rows. Event identifiers and signatures are length-bounded, completed deliveries are idempotent, and incomplete deliveries are safely retried.

6. **Retryable payment failures now return a non-success response.** A temporary Razorpay or database failure leaves the event unprocessed and returns `503`, allowing Razorpay to redeliver it instead of permanently losing a legitimate capture.

7. **Payment settlement is atomic.** A new database function locks the order and payment and updates them in one transaction. A capture arriving after customer cancellation moves the order to `Payment Review` and emits an operational alert; the system can no longer leave a paid order labelled `Cancelled`.

8. **The script Content Security Policy no longer permits broad inline execution.** Inline page scripts receive exact SHA-256 grants and the small set of legacy image error handlers receive exact hashes. This materially reduces the impact of injected HTML or script.

9. **Malformed URL fragments are handled safely.** Invalid percent-encoding now falls back to the default catalogue/store view instead of throwing and breaking the page.

10. **Operational payment alerts are structured and redacted.** Webhook retry failures, captures requiring review, reconciliation discrepancies, and reconciliation failures are written to platform logs and can be forwarded to an HTTPS alert receiver. Customer data, request bodies, and access tokens are excluded.

11. **Production configuration fails at startup when unsafe or incomplete.** Supabase URL/key, session-secret strength, exact HTTPS origins, and the optional alert URL are validated before the server accepts traffic.

12. **Proxy handling is safe for the declared platform.** Vercel uses one trusted proxy hop automatically; other deployments remain opt-in. This preserves correct client IP rate limiting without trusting arbitrary forwarding headers.

## Migration recheck

The configured live Supabase schema was inspected read-only by checking the actual columns and RPCs. These migrations are already present and **do not need to be rerun**:

| Migration | Live evidence | Result |
|---|---|---|
| 020 | All four order money columns report Postgres `numeric` | Applied |
| 025 | `create_store_order` RPC is present | Applied |
| 027 | Enquiry phone is a nullable string/text column | Applied |
| 028 | `user_profiles.password_hash` is present | Applied |
| 029 | Quote pricing snapshot columns and `create_quote_request` RPC are present | Applied |
| 030 | Invoice and seller snapshot columns are present | Applied |
| 031 | Guest token hash is present and order ownership is nullable | Applied |

Two customer profiles still have a null password hash. The application locks these accounts rather than allowing passwordless access. They need an operator-managed password reset; no password should be invented or backfilled in a migration.

Two new migrations were created by this hardening work and are **not yet applied**:

- `032_shared_runtime_state.sql` — shared production session and rate-limit state.
- `033_atomic_payment_settlement.sql` — atomic captured-payment settlement and the `Payment Review` order state.

They must be applied in that order before the matching application code is deployed.

## Storefront fixes completed

- Product cards now expose a real keyboard control with a focus stop, button semantics, an accessible label, and Enter/Space handling. Product details are no longer mouse-only across the shared product surfaces.
- Malformed catalogue and store URL fragments now recover to a working default view.
- The About page, blog index, and all eight blog article routes were verified as real pages with working headings, skip targets, and no horizontal overflow. No duplicate pages were created.
- The existing bundle cards, combination-item behavior, and related presentation were not changed.

## Commercial and identity fixes completed

- GST is fixed at the confirmed **18%** default.
- Delivery below ₹50,000 is disclosed as **collected at the point of delivery** and is not added to the website order total.
- Purchases of **₹50,000 or more receive free delivery**.
- Checkout summary, checkout submission, and the displayed customer total continue to use the same server-side pricing function.
- The formal seller snapshot uses the existing business record: SRK Team Star / Pooja Rani, GSTIN, postal address, email, phone, and Haryana state. A typo in the published address was corrected from “Water Busting Station” to “Water Boosting Station.”
- Bank details were not invented or exposed. Website payments use Razorpay or cash on delivery; any future bank-transfer details should be supplied and approved by the business before publication.

## Production configuration completed in code

- Shared serverless sessions and shared per-route rate limits.
- Secure-cookie behavior based on the actual TLS connection.
- Exact-origin CORS support for the guest order access header.
- Fail-fast production environment validation.
- Safe Vercel proxy configuration.
- Redacted payment and reconciliation alerting with optional HTTPS forwarding.
- Updated environment example and operating instructions.
- Reconciliation remains read-only, locked against overlap, logged, and now alert-enabled.

## Verification results

- Structural verification: **passed** — 675 references, 85 backend source files, module boundaries, boot, and exact 24-route API surface.
- API and authorization suite: **82 passed, 0 failed**.
- Payment security suite: **58 passed, 0 failed**.
- Browser journey suite: **65 passed, 0 failed**.
- Rebuilt production Tailwind stylesheet: **passed**.
- Production dependency audit: **0 known vulnerabilities** across 105 production dependencies.
- Diff whitespace/error check: **passed**.

## Required actions before final production sign-off

1. Take a current Supabase backup, then apply migrations **032** and **033**, in order.
2. Update the separate administration console so staff can see and resolve the new `Payment Review` order state before accepting live payments.
3. In the production host, set and verify `NODE_ENV=production`, Supabase credentials, a unique session secret of at least 48 characters, exact HTTPS allowed origins if cross-origin access is required, and Razorpay **live** key/webhook credentials. The inspected local configuration is still in Razorpay test mode.
4. Configure `OPERATIONAL_ALERT_WEBHOOK_URL` or an equivalent platform-log alert rule and test receipt of a redacted alert.
5. Install the daily reconciliation schedule on an always-on production operator host. It is not installed on this development machine, and a Vercel serverless process is not a persistent scheduler.
6. Reset credentials for the two locked legacy customer profiles through an operator-controlled identity check.
7. Deploy to staging, execute one real low-value gateway payment plus webhook redelivery, verify its invoice, cancellation controls, and reconciliation output, then promote the same build to production.

Until items 1–7 are completed, the correct sign-off status is **application fixes complete; production deployment approval pending**.

## Follow-up execution requested after this report

- The separate admin console now accepts and displays `Payment Review`, provides a review warning, and prevents that state from being offered as a destination for ordinary orders. Its verification completed with 86 API assertions, 8 security-control assertions, and 7 browser journeys passing.
- A GitHub Actions reconciliation workflow is now included at `.github/workflows/payment-reconciliation.yml`. It is ready to run daily at 02:30 IST once this branch is deployed and the five Razorpay/Supabase secrets plus the optional alert receiver are added to GitHub Actions.
- An operator-only `set-customer-password` command is now included. It requires the customer identifier and an interactively entered password; the final reset cannot be performed here because the two customer identities and approved replacement passwords were not supplied.
- The Vercel dashboard is signed in to the correct team, but its account session reached the usage limit while settings were being edited. No production secrets were transmitted or changed. The storefront currently has no Razorpay key pair/webhook secret or alert URL configured; the admin project still needs `STOREFRONT_URL`.

### Tasks 2–7 execution status

| Task | Result |
|---|---|
| 2. Administration console | Completed in `admin-dashboard-srk`: `Payment Review` contract, badge, warning, guarded transitions, and tests. |
| 3. Production environment | Code validation is complete. Vercel project inventory is verified, but live Razorpay credentials are absent and cannot be fabricated; admin `STOREFRONT_URL` still needs the approved production origin. |
| 4. Operational alerting | Redacted application events and the alert hook are implemented. No approved alert receiver URL exists; Vercel’s native anomaly-alert screen requires a plan upgrade. |
| 5. Reconciliation schedule | A GitHub Actions daily workflow is added in the working tree. It becomes active after push and after the required GitHub Actions secrets are added. No developer-machine scheduled task was installed because it would not monitor the Vercel production deployment. |
| 6. Legacy customer resets | A hidden-input, customer-only reset command is implemented. The actual two resets require the customers’ approved replacement passwords and identifier confirmation. |
| 7. Staging smoke test | All local production-like API, payment, browser, invoice, cancellation, and retry tests pass. A real Razorpay staging charge cannot be submitted without live test credentials and payment authorization. |
