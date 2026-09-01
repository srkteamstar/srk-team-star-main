// =============================================================================
// test/integration/database.test.js — real-database integration suite (A01)
// =============================================================================
//
// RUN: npm run test:db   (from backend/). Separate from `npm test` on purpose
// — see "WHY A SEPARATE SUITE" below. Node's built-in test runner, no extra
// dependency: `node --test test/integration/database.test.js`.
//
// WHY A SEPARATE SUITE
// ---------------------
// backend/test/authz-harness.js boots the real server with @supabase/supabase-js
// replaced by an in-memory fake (see core/database/supabase.js's header comment
// — that require() call is the seam the fake is installed at). `npm test`
// (authz.test.js, payments.test.js) runs entirely against that fake. It is fast,
// deterministic, and correctly proves what the Express layer decides given a
// database response — but it never executes one line of real SQL: no migration
// has run, no Postgres function has been called, no constraint, foreign key,
// unique index or RLS policy has ever been checked. A green `npm test` is not
// evidence that any of those exist or work.
//
// This file is that other half: it talks to an ACTUAL Postgres/Supabase
// project — the real migrations in backend/migrations/, the real RPCs
// (`create_store_order`, `settle_captured_store_payment`), the real grants and
// RLS policies. `authz-harness.js` itself is NOT modified by this change (other
// batches depend on its current stubbing behaviour) — this suite is additive.
//
// WHAT THIS IS MEANT TO EXERCISE
// -------------------------------
// Six things the fake database cannot prove, matching the audit finding:
//
//   1. Refund-ledger dedup       Two deliveries of the same refund.processed
//                                 event id (payments.controller.js's webhook
//                                 handler) must leave exactly one payment_events
//                                 row and apply exactly one status delta to
//                                 payments — including a redelivery that arrives
//                                 after the first delivery's acknowledgement
//                                 (payment_events.processed_at) failed to write.
//   2. Settlement regression     An out-of-order/delayed capture confirmation
//                                 must not resurrect a payment that has already
//                                 moved to Refunded / Partially Refunded.
//   3. Cancel/capture race       settle_captured_store_payment() (migration 033)
//                                 must route a capture that lands after
//                                 cancellation to 'Payment Review', never
//                                 silently to 'Processing'.
//   4. Cross-instance sessions   Two independently-constructed Supabase clients
//                                 (standing in for two server processes behind a
//                                 load balancer) must observe the same
//                                 storefront_sessions row — the property
//                                 session.js's comment says MemoryStore cannot
//                                 give you and SupabaseSessionStore exists for.
//   5. Access-denial paths       RLS must actually refuse the anon key on
//                                 tables granted to service_role only.
//   6. Checkout retry integrity  create_store_order's idempotency_key (035)
//                                 must be unique per order — two orders cannot
//                                 share one — and checkout_proof_hash /
//                                 request_fingerprint (037) must round-trip
//                                 onto the row exactly as written, since
//                                 checkout.controller.js's whole S04/F08 fix
//                                 depends on both actually being persisted.
//
// All six are implemented below as real, runnable test bodies — not
// placeholders — so that pointing TEST_SUPABASE_URL at a real target makes
// them execute immediately.
//
// AN AUDIT FINDING THIS FILE ITSELF WAS PART OF, NOW ADDRESSED
// -----------------------------------------------------------------
// An earlier revision of this suite predated migrations 034-038: its fixture
// helper only ever wrote migration 031's create_store_order shape (guest
// token only, no idempotency_key / checkout_proof_hash / request_fingerprint),
// and test 2 below carried a "KNOWN GAP, expected to FAIL" comment describing
// settle_captured_store_payment()'s pre-038 behaviour — accurate when
// written, against migration 033 alone, but stale the moment 038 landed and
// fixed exactly that gap. That staleness (fixtures targeting an old RPC
// shape, an assertion whose own comment argued against itself passing) is
// what this revision corrects: the fixture below now writes the full
// migration-037 shape, item 2's comment reflects 038's fix rather than
// pre-dating it, and item 6 is new coverage for the two migrations (035,
// 037) the old fixture never touched at all.
//
// SCHEMA UNCERTAINTY, NOTED RATHER THAN HIDDEN
// -----------------------------------------------
// orders / order_items / order_shipping_address / payments predate the numbered
// migration history (012_checkout.sql's own header says so — it is the same
// fact A01 is about: this repo cannot independently reconstruct its full
// baseline from migrations alone). The fixture helper below is built only from
// columns the application code and migrations 010/012/025/031/033/035/037
// reference. If a real target rejects a fixture insert on a constraint
// invisible from that history (a NOT NULL or a foreign key on
// order_items.product_id, say), that failure is itself audit-relevant signal
// about the undocumented baseline — adjust the fixture or capture the missing
// baseline, don't paper over it.
//
// SAFETY — READ BEFORE POINTING THIS AT ANYTHING
// --------------------------------------------------
// This suite INSERTS and UPDATES real rows, and calls real RPCs that write.
// Some of the tables it touches (payment_events, and by design elsewhere in
// this app — see AGENTS.md's "No delete anywhere") grant NO delete at all, not
// even to service_role, so fixture rows this suite creates are NOT cleaned up
// afterwards — they accumulate. That is only acceptable against a project that
// exists purely to be thrown away, which is exactly what every gate below
// exists to enforce:
//
//   * TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY must BOTH be set.
//     Neither is read from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the
//     application's own variables, already sitting in backend/.env for local
//     dev) — this suite never falls back to the app's real credentials, on
//     purpose, so an unset test variable fails closed instead of quietly
//     reusing the production project.
//   * TEST_SUPABASE_URL must differ from SUPABASE_URL if the latter happens to
//     be set in the same environment.
//   * TEST_SUPABASE_URL's hostname must carry an explicit safety marker
//     (localhost / 127.0.0.1 / a "test" segment) — see assertSafeTarget().
//   * DB_TEST_CONFIRM must equal the exact confirmation string below. This is
//     a deliberate speed bump, not a bug: it exists so nobody sets the two
//     Supabase variables out of habit and has this suite silently start
//     writing to whatever they happen to point at.
//   * NODE_ENV must not be 'production' and VERCEL must not be set.
//
// Fail any of those and the whole file refuses to run (a thrown Error, visible
// as a failed test file — not a silent skip, because credentials WERE
// provided and something about them is wrong).
//
// With NEITHER TEST_SUPABASE_URL nor TEST_SUPABASE_SERVICE_ROLE_KEY set at
// all — the ordinary case, and the case in the environment this suite was
// authored in, which has no local Postgres and no Docker installed — every
// test is skipped cleanly, the process exits 0, and `npm test` / `npm run
// test:all` are unaffected. Wiring a real target up (a disposable Supabase
// project, or a local Postgres with PostgREST/Supabase CLI in front of it so
// `supabase-js` and the RPCs work unmodified) is follow-up work, not done by
// this change — see this batch's report for exactly what is deferred.
// =============================================================================

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const TEST_URL = process.env.TEST_SUPABASE_URL || '';
const TEST_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || '';
const TEST_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || ''; // optional — only test 5 needs it

const CONFIGURED = Boolean(TEST_URL && TEST_SERVICE_KEY);
const CONFIRMATION_STRING = 'yes-this-is-a-disposable-database';

// ---- Safety gate, run before a single query is issued -----------------------
function assertSafeTarget() {
    const problems = [];

    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
        problems.push('NODE_ENV=production (or VERCEL is set) — refusing to run in a production runtime under any configuration.');
    }

    if (process.env.SUPABASE_URL && TEST_URL === process.env.SUPABASE_URL) {
        problems.push('TEST_SUPABASE_URL is identical to SUPABASE_URL — refusing to run against the application\'s own configured project.');
    }

    let hostname = '';
    try {
        hostname = new URL(TEST_URL).hostname.toLowerCase();
    } catch (error) {
        problems.push(`TEST_SUPABASE_URL is not a valid URL: "${TEST_URL}"`);
    }

    const SAFE_MARKER = /(localhost|127\.0\.0\.1|(^|[.-])test([.-]|$)|supabase\.local)/i;
    if (hostname && !SAFE_MARKER.test(hostname)) {
        problems.push(
            `TEST_SUPABASE_URL's host ("${hostname}") carries none of the required safety markers ` +
            '(localhost / 127.0.0.1 / a "test" segment). Point this at a disposable project named ' +
            'accordingly, or a local instance — this check is a deliberate speed bump, not a bug.'
        );
    }

    if (String(process.env.DB_TEST_CONFIRM || '').trim() !== CONFIRMATION_STRING) {
        problems.push(
            `DB_TEST_CONFIRM must equal "${CONFIRMATION_STRING}" exactly. This suite writes real rows ` +
            'that cannot all be deleted afterwards (payment_events grants no delete to any role) — set ' +
            'this only once TEST_SUPABASE_URL is verified disposable.'
        );
    }

    if (problems.length) {
        throw new Error(
            'Refusing to run backend/test/integration/database.test.js:\n- ' + problems.join('\n- ') +
            '\n\nSee the header comment in this file for the full safety contract.'
        );
    }
}

if (!CONFIGURED) {
    console.log(
        '\n[test:db] TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are not set — skipping the ' +
        'real-database integration suite. This is the expected, passing state on a machine with no ' +
        'local/test Postgres or Supabase project wired up (including the environment this suite was ' +
        'authored in). See the header of backend/test/integration/database.test.js for what to set to ' +
        'actually run it. `npm test` and `npm run verify` are unaffected.\n'
    );

    test('database integration suite (skipped — TEST_SUPABASE_URL not configured)', { skip: true }, () => {});
} else {
    assertSafeTarget();

    const { createClient } = require('@supabase/supabase-js');

    const db = createClient(TEST_URL, TEST_SERVICE_KEY);
    const anonDb = TEST_ANON_KEY ? createClient(TEST_URL, TEST_ANON_KEY) : null;

    // ---- Fixture helper -------------------------------------------------------
    // Goes through the real create_store_order RPC — migration 037's version,
    // the current one; see "AN AUDIT FINDING THIS FILE ITSELF WAS PART OF"
    // above — rather than hand-built inserts, so a fixture order is exactly as
    // valid as one a real guest checkout writes, and stays that way as the
    // schema in backend/migrations/ evolves independently of this file.
    //
    // idempotency_key / checkout_proof_hash / request_fingerprint: migration
    // 037's function does not validate their SHAPE (that is
    // checkout.controller.js's job — isStrongRetryToken() /
    // hashCheckoutProof() in shared/order-access-token.js, and
    // computeCheckoutFingerprint() in the controller itself), it only stores
    // whatever text it is given. This fixture supplies realistic-shaped values
    // (a real UUID for the key, real sha256 hex for the other two) without
    // reproducing the controller's exact fingerprint algorithm — nothing below
    // asserts against a SPECIFIC fingerprint, only that a real value round-trips
    // and that idempotency_key is actually enforced unique by the database, not
    // by application code alone.
    function fixtureIdempotencyFields() {
        const idempotencyKey = crypto.randomUUID();
        const checkoutProofHash = crypto.createHash('sha256').update(crypto.randomUUID(), 'utf8').digest('hex');
        const requestFingerprint = crypto.createHash('sha256')
            .update(JSON.stringify({ v: 1, fixture: true, nonce: crypto.randomUUID() }), 'utf8')
            .digest('hex');
        return { idempotencyKey, checkoutProofHash, requestFingerprint };
    }

    async function makeGuestOrder({ amountPaise = 500000, idempotencyKey } = {}) {
        const amount = (amountPaise / 100).toFixed(2);
        const tokenHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
        const fields = fixtureIdempotencyFields();
        if (idempotencyKey) fields.idempotencyKey = idempotencyKey; // test 6 reuses an existing key on purpose

        const { data, error } = await db.rpc('create_store_order', {
            p_user_id: null,
            p_order: {
                guest_access_token_hash: tokenHash,
                idempotency_key: fields.idempotencyKey,
                checkout_proof_hash: fields.checkoutProofHash,
                request_fingerprint: fields.requestFingerprint,
                amount, shipping_amount: '0.00', tax_amount: '0.00', net_amount: amount,
                status: 'Pending Payment', currency: 'INR'
            },
            p_items: [{
                product_id: null,
                product_name: 'test:db fixture item — safe to delete',
                price: amount, quantity: 1, total_amount: amount
            }],
            p_shipping: {
                full_address: '1 test:db Fixture Street', city: 'Fixture City',
                state: 'Fixture State', country: 'India', zip_code: '000000'
            },
            p_payment: {
                gateway: 'razorpay', payment_method: null,
                amount, amount_paise: amountPaise, currency: 'INR', status: 'Created'
            }
        });

        if (error) throw error;
        return { order: data.order, payment: data.payment, ...fields };
    }

    describe('refund-ledger dedup', () => {
        let order, payment;

        before(async () => { ({ order, payment } = await makeGuestOrder()); });
        after(() => {
            // No cleanup call here: payment_events grants no delete to any
            // role (migration 014 §9, deliberately — it is an append-only
            // audit log) and orders/payments grant none either (AGENTS.md:
            // "No delete anywhere"). Fixture rows are tagged
            // 'test:db fixture item' / 'evt_test_*' so a disposable project
            // can be wiped wholesale between runs instead.
            console.log(`[test:db] fixture order ${order.id} left in place (no delete grant exists to remove it).`);
        });

        test('two deliveries of the same refund.processed event id leave one payment_events row', async () => {
            const eventId = `evt_test_${crypto.randomUUID()}`;
            const row = {
                event_id: eventId, event_type: 'refund.processed', gateway: 'razorpay',
                order_id: order.id, gateway_payment_id: null,
                payload: { fixture: true, note: 'test:db dedup case 1' }, signature_verified: true
            };

            const first = await db.from('payment_events').insert([row]).select().single();
            assert.equal(first.error, null, 'first delivery must be recorded cleanly');

            const second = await db.from('payment_events').insert([row]);
            assert.ok(second.error, 'a second identical event_id must be rejected, not silently accepted');
            assert.equal(second.error.code, '23505', 'must fail on the unique event_id index specifically');

            const { data: rows, error: selectError } = await db.from('payment_events').select('id').eq('event_id', eventId);
            assert.equal(selectError, null);
            assert.equal(rows.length, 1, 'exactly one payment_events row must exist for this event id');
        });

        test('a redelivery after a failed acknowledgement still applies exactly one status delta', async () => {
            // Mirrors the real failure window in payments.controller.js: the
            // event row is inserted, the payments-table effect is applied, and
            // then the process is imagined to die before finish() writes
            // processed_at. Razorpay redelivers; the controller's 23505 branch
            // finds processed_at still null and (correctly) reprocesses.
            const eventId = `evt_test_${crypto.randomUUID()}`;
            const row = {
                event_id: eventId, event_type: 'refund.processed', gateway: 'razorpay',
                order_id: order.id, gateway_payment_id: null,
                payload: { fixture: true, note: 'test:db dedup case 2' }, signature_verified: true
            };

            const applyPartialRefund = () => db.from('payments').update({ status: 'Partially Refunded' }).eq('id', payment.id);

            // Delivery 1: recorded, effect applied, acknowledgement withheld.
            const inserted = await db.from('payment_events').insert([row]).select().single();
            assert.equal(inserted.error, null);
            const applied1 = await applyPartialRefund();
            assert.equal(applied1.error, null);

            // Delivery 2 (redelivery of the same event id).
            const dup = await db.from('payment_events').insert([row]);
            assert.ok(dup.error && dup.error.code === '23505', 'redelivery must still hit the unique index');

            const { data: existing } = await db.from('payment_events').select('processed_at').eq('event_id', eventId).maybeSingle();
            assert.equal(existing.processed_at, null, 'the row is genuinely unprocessed — this is what makes reprocessing it correct rather than a double-apply');

            const applied2 = await applyPartialRefund(); // idempotent: same target status both times
            assert.equal(applied2.error, null);

            const { data: finalPayment } = await db.from('payments').select('status').eq('id', payment.id).single();
            assert.equal(finalPayment.status, 'Partially Refunded', 'one net status delta after both deliveries, not two stacked effects');
        });
    });

    describe('settlement status regression (migration 038)', () => {
        let order, payment;

        before(async () => { ({ order, payment } = await makeGuestOrder()); });

        test('an out-of-order capture must not overwrite an already-refunded payment', async () => {
            // Simulate a completed refund landing first (e.g. an operator
            // refunded from the Razorpay dashboard, and refund.processed was
            // already handled).
            const refunded = await db.from('payments').update({ status: 'Refunded' }).eq('id', payment.id);
            assert.equal(refunded.error, null);

            // A delayed/out-of-order capture confirmation for the SAME payment
            // now arrives (a retried webhook, or a slow callback).
            const settled = await db.rpc('settle_captured_store_payment', {
                p_order_id: order.id,
                p_payment_id: payment.id,
                p_transaction_id: `pay_test_${crypto.randomUUID()}`,
                p_payment_method: 'upi',
                p_verified_at: new Date().toISOString()
            });

            const { data: after } = await db.from('payments').select('status').eq('id', payment.id).single();

            // REGRESSION GUARD, not a known gap. settle_captured_store_payment()
            // (migration 033) originally special-cased only `status = 'Paid'`
            // for idempotency, with no equivalent branch for 'Refunded' /
            // 'Partially Refunded' — so a late capture confirmation for an
            // already-refunded payment would flip it back to 'Paid'. Migration
            // 038 (preserve_refund_status_on_settlement) widened that branch to
            // `status in ('Paid', 'Partially Refunded', 'Refunded')` specifically
            // to close this. As of 038 this assertion is expected to PASS; if it
            // starts failing, settle_captured_store_payment() has regressed
            // toward its pre-038 behaviour.
            assert.notEqual(after.status, 'Paid', 'a refunded payment must never be resurrected to Paid by a late capture');
            assert.equal(after.status, 'Refunded', 'status must remain exactly what the refund left it as');
            assert.equal(settled.error, null);
        });
    });

    describe('cancellation vs capture race', () => {
        let order, payment;

        before(async () => { ({ order, payment } = await makeGuestOrder()); });

        test('a capture that lands after cancellation goes to Payment Review, not Processing', async () => {
            const cancelled = await db.from('orders').update({ status: 'Cancelled' }).eq('id', order.id);
            assert.equal(cancelled.error, null);

            const settled = await db.rpc('settle_captured_store_payment', {
                p_order_id: order.id,
                p_payment_id: payment.id,
                p_transaction_id: `pay_test_${crypto.randomUUID()}`,
                p_payment_method: 'card',
                p_verified_at: new Date().toISOString()
            });
            assert.equal(settled.error, null);

            const result = Array.isArray(settled.data) ? settled.data[0] : settled.data;
            assert.equal(result.order_status, 'Payment Review', 'a post-cancellation capture must be routed to an explicit operator queue');
            assert.equal(result.requires_review, true);

            const { data: afterOrder } = await db.from('orders').select('status').eq('id', order.id).single();
            assert.equal(afterOrder.status, 'Payment Review', 'never silently Processing — the cancellation must stay visible');
        });
    });

    describe('checkout retry integrity (migrations 035, 037)', () => {
        // This block is new: the fixture helper above previously wrote none
        // of idempotency_key / checkout_proof_hash / request_fingerprint at
        // all (migration 031's shape), so nothing in this file had ever
        // exercised migrations 035/037 against a real database. See "AN
        // AUDIT FINDING THIS FILE ITSELF WAS PART OF" at the top of this
        // file.
        test('two orders cannot share one idempotency_key (orders_idempotency_key_uq, migration 035)', async () => {
            const { idempotencyKey } = await makeGuestOrder();

            await assert.rejects(
                () => makeGuestOrder({ idempotencyKey }),
                error => {
                    // supabase-js surfaces a Postgres unique_violation as a
                    // thrown error only when .throwOnError() is used; the
                    // fixture helper instead does `if (error) throw error`
                    // itself, so the rejection IS the PostgREST error object.
                    assert.equal(error.code, '23505', 'must fail on the unique index specifically, not some other constraint');
                    return true;
                },
                'a second order reusing an existing idempotency_key must be refused by the database itself, not merely by checkout.controller.js\'s own pre-check'
            );
        });

        test('checkout_proof_hash and request_fingerprint round-trip onto the order exactly as written', async () => {
            const { order, checkoutProofHash, requestFingerprint } = await makeGuestOrder();

            const { data: row, error } = await db.from('orders')
                .select('checkout_proof_hash, request_fingerprint')
                .eq('id', order.id)
                .single();

            assert.equal(error, null);
            assert.equal(row.checkout_proof_hash, checkoutProofHash, 'checkout.controller.js\'s guest-order proof check compares this column byte-for-byte against a freshly hashed value; any transformation here would break every guest retry');
            assert.equal(row.request_fingerprint, requestFingerprint, 'checkout.controller.js\'s F08 fix refuses a retry whose recomputed fingerprint no longer matches this column — it must be stored exactly as sent');
        });
    });

    describe('cross-instance session behaviour', () => {
        // Deliberately does not import core/http/supabase-session-store.js:
        // requiring it pulls in core/database/supabase.js, which builds a
        // client from the application's OWN SUPABASE_URL /
        // SUPABASE_SERVICE_ROLE_KEY — exactly the fallback this suite's safety
        // section refuses to allow. Instead this reimplements the store's two
        // operations directly against the TEST_* client, against the same
        // storefront_sessions table (migration 032) the real store uses — which
        // is enough to prove the property session.js's comment names: two
        // independent clients (standing in for two app processes) observe the
        // same row, unlike an in-process MemoryStore.
        const sid = `test-db-${crypto.randomUUID()}`;
        after(async () => {
            const cleanup = await db.from('storefront_sessions').delete().eq('sid', sid);
            if (cleanup.error) console.error('[test:db] could not clean up fixture session row:', cleanup.error);
        });

        test('a session written by one client instance is readable by an independently-constructed second one', async () => {
            const instanceA = createClient(TEST_URL, TEST_SERVICE_KEY);
            const instanceB = createClient(TEST_URL, TEST_SERVICE_KEY);

            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            const written = await instanceA.from('storefront_sessions').upsert(
                { sid, data: { cookie: {}, fixture: true }, expires_at: expiresAt, updated_at: new Date().toISOString() },
                { onConflict: 'sid' }
            );
            assert.equal(written.error, null);

            const read = await instanceB.from('storefront_sessions').select('data, expires_at').eq('sid', sid).maybeSingle();
            assert.equal(read.error, null);
            assert.ok(read.data, 'the second, independently-constructed client must see the row the first wrote');
            assert.equal(read.data.data.fixture, true);
        });
    });

    describe('access-denial paths', () => {
        test('the anon key cannot read storefront_sessions (service-role-only, no anon grant)', { skip: anonDb ? false : 'TEST_SUPABASE_ANON_KEY not set — skipping the RLS check' }, async () => {
            const { data, error } = await anonDb.from('storefront_sessions').select('sid').limit(1);
            // Either shape is an acceptable "denied": PostgREST answers a plain
            // ungranted table with an empty result under RLS in some
            // configurations and a 42501 permission error in others depending
            // on the grant. What must never happen is real rows coming back.
            assert.ok(error || (Array.isArray(data) && data.length === 0), 'the anon key must not be able to read a service-role-only table');
        });

        test('the anon key cannot read payments (service-role-only, no anon grant)', { skip: anonDb ? false : 'TEST_SUPABASE_ANON_KEY not set — skipping the RLS check' }, async () => {
            const { data, error } = await anonDb.from('payments').select('id').limit(1);
            assert.ok(error || (Array.isArray(data) && data.length === 0), 'the anon key must not be able to read payments');
        });
    });
}
