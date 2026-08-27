#!/usr/bin/env node
// =============================================================================
// reconcile.js — does the gateway's ledger agree with ours?
// =============================================================================
//
//   node scripts/reconcile.js                      # today
//   node scripts/reconcile.js 2026-08-25           # that day
//   node scripts/reconcile.js 2026-08-01 2026-08-25  # a range, inclusive
//   node scripts/reconcile.js --days=7             # the last 7 days
//
// WHY THIS EXISTS, AND WHY IT IS THE ONE SCRIPT THAT CAN FIND WHAT IS MISSING
// ---------------------------------------------------------------------------
// inspect-order.js and check-webhook.js both start from something this
// database already knows about, which makes them blind in the same direction:
// they can tell you whether a payment we HAVE is correct, and they can never
// tell you about one we do not have at all.
//
// That is the failure mode that costs money, and it is silent by construction:
//
//   the customer pays;
//   the browser callback never arrives (tab closed, UPI app did not switch
//     back, phone rang);
//   the webhook never arrives either (a stale tunnel URL, a rotated secret, an
//     endpoint that 500'd until Razorpay stopped retrying);
//
// and every record on this side says the order is unpaid. There is nothing to
// notice. The customer's bank statement and the Razorpay dashboard both say
// otherwise, and you find out when they email.
//
// It genuinely happened here in a smaller form: webhooks were arriving and
// verifying perfectly while `payment_events.order_id` silently failed to write
// on every single delivery (a missing column GRANT, fixed by migration 019).
// Nothing was broken enough to fail; nothing reported anything. A diff against
// the gateway is the only check that would have shown it.
//
// WHAT IT COMPARES
// ----------------
// Razorpay's payments in the window, against `payments` rows in the same
// window, joined on the gateway payment id (payments.transaction_id).
//
//   MISSING HERE      captured at the gateway, nothing Paid on our side.
//                     MONEY MOVED AND WE DO NOT KNOW. The urgent one.
//   AMOUNT MISMATCH   both sides have it, the paise differ.
//   NOT AT GATEWAY    we say Paid, the gateway has no such captured payment.
//   UNCAPTURED        authorised and never captured. Not money; auto-refunded
//                     after five days. Listed because a lot of them means the
//                     capture setting is wrong.
//
// READ ONLY. Nothing here writes — deliberately. Recording a payment we
// missed means running it through markOrderPaid(), which re-verifies from
// scratch; a reconciliation tool that "fixes" rows is one that can quietly
// mark things paid, and that is the single sentence this codebase is most
// careful about. This tells you what to look at.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const razorpay = require('../src/core/gateways/razorpay');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PAYMENTS_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_ENABLED || '').trim());

const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

function window_() {
    if (daysArg) {
        const days = Number(daysArg.split('=')[1]);
        if (!Number.isFinite(days) || days < 1) throw new Error('--days must be a number of at least 1.');
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        return { from, to };
    }

    // Local midnight to local midnight. Razorpay reports in the account's own
    // timezone and the operator reading this is in the same one, so local is
    // the honest boundary — a UTC day would split an Indian trading day in two
    // and make every figure disagree with the dashboard by a few late orders.
    const day = (text) => {
        const [y, m, d] = text.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
    };
    const endOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    if (dates.length >= 2) return { from: day(dates[0]), to: endOf(day(dates[1])) };
    if (dates.length === 1) return { from: day(dates[0]), to: endOf(day(dates[0])) };

    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: endOf(now) };
}

// UNIX SECONDS. Razorpay answers a millisecond timestamp with an empty list
// rather than an error, which reads as a quiet day instead of a unit bug.
const unix = (date) => Math.floor(date.getTime() / 1000);

const paise = (v) => (v === null || v === undefined ? '—' : '₹ ' + (Number(v) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }));
const when = (v) => (v ? new Date(v).toLocaleString() : '—');

/** Every payment in the window, paged. Razorpay caps `count` at 100. */
async function allGatewayPayments(from, to) {
    const found = [];
    let skip = 0;

    for (;;) {
        const page = await razorpay.listPayments({ from: unix(from), to: unix(to), count: 100, skip });
        const items = (page && page.items) || [];
        found.push(...items);

        if (items.length < 100) break;
        skip += 100;

        // A window wide enough to need this many pages is one where the
        // operator wants a narrower question, not a longer wait.
        if (skip > 10000) {
            console.warn('  ! Stopped paging at 10,000 payments. Narrow the date range.');
            break;
        }
    }

    return found;
}

async function main() {
    if (!PAYMENTS_ENABLED || !razorpay.isConfigured()) {
        console.error('\nPAYMENTS_ENABLED is not set, or the Razorpay keys are missing from backend/.env.');
        console.error('There is nothing to reconcile against.\n');
        process.exit(1);
    }

    const { from, to } = window_();

    console.log('\n' + '='.repeat(72));
    console.log('  PAYMENT RECONCILIATION');
    console.log(`  ${when(from)}  ->  ${when(to)}`);
    console.log('='.repeat(72));

    const [gatewayPayments, ourRows] = await Promise.all([
        allGatewayPayments(from, to),
        (async () => {
            const { data, error } = await db
                .from('payments')
                .select('*')
                .eq('gateway', 'razorpay')
                .gte('created_at', from.toISOString())
                .lte('created_at', to.toISOString());
            if (error) throw error;
            return data || [];
        })()
    ]);

    const ourByTransaction = new Map(
        ourRows.filter(r => r.transaction_id).map(r => [String(r.transaction_id), r])
    );

    const captured = gatewayPayments.filter(p => p.status === 'captured');
    const uncaptured = gatewayPayments.filter(p => p.status === 'authorized');

    const missingHere = [];
    const mismatched = [];
    let matched = 0;

    for (const payment of captured) {
        const ours = ourByTransaction.get(String(payment.id));

        if (!ours || ours.status !== 'Paid') {
            missingHere.push({ payment, ours });
            continue;
        }

        if (Number(ours.amount_paise) !== Number(payment.amount)) {
            mismatched.push({ payment, ours });
            continue;
        }

        matched += 1;
    }

    // The other direction: rows we call Paid that the gateway did not report
    // as captured in this window. Usually a boundary effect (paid just before
    // `from`, our row written just after) rather than a problem — which is why
    // it is reported separately and not as an alarm.
    const capturedIds = new Set(captured.map(p => String(p.id)));
    const notAtGateway = ourRows.filter(r => r.status === 'Paid' && r.transaction_id && !capturedIds.has(String(r.transaction_id)));

    const totalCaptured = captured.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalOurs = ourRows.filter(r => r.status === 'Paid').reduce((sum, r) => sum + Number(r.amount_paise || 0), 0);

    console.log('\n  TOTALS');
    console.log(`    Razorpay captured in window   ${captured.length} payment(s)   ${paise(totalCaptured)}`);
    console.log(`    Recorded 'Paid' here          ${ourRows.filter(r => r.status === 'Paid').length} payment(s)   ${paise(totalOurs)}`);
    console.log(`    Reconciled exactly            ${matched}`);

    if (missingHere.length) {
        console.log('\n  ' + '!'.repeat(66));
        console.log(`  MONEY MOVED AND WE DID NOT RECORD IT — ${missingHere.length} payment(s)`);
        console.log('  ' + '!'.repeat(66));
        for (const { payment, ours } of missingHere) {
            const ourOrder = payment.notes && payment.notes.order_id ? `our order ${payment.notes.order_id}` : 'no order_id in notes';
            console.log(`    ${payment.id}   ${paise(payment.amount)}   ${when(payment.created_at * 1000)}`);
            console.log(`        gateway order ${payment.order_id}   ${ourOrder}   method ${payment.method || '—'}`);
            console.log(`        our row: ${ours ? `id ${ours.id}, status ${ours.status}` : 'NONE — no payments row carries this transaction id'}`);
        }
        console.log('\n    Check the webhook first: node scripts/check-webhook.js');
        console.log('    Then look at the order:  node scripts/inspect-order.js <id>');
        console.log('    Nothing here writes. Settling one means letting a real delivery through');
        console.log('    markOrderPaid() — resend the event from the Razorpay dashboard.');
    }

    if (mismatched.length) {
        console.log(`\n  AMOUNT MISMATCH — ${mismatched.length} payment(s)`);
        for (const { payment, ours } of mismatched) {
            console.log(`    ${payment.id}   gateway ${paise(payment.amount)}   ours ${paise(ours.amount_paise)}   order ${ours.order_id}`);
        }
        console.log('    markOrderPaid() refuses these, so they should never reach Paid.');
        console.log('    If one has, that is a bug in the amount check and is urgent.');
    }

    if (notAtGateway.length) {
        console.log(`\n  PAID HERE, NOT CAPTURED IN THIS WINDOW — ${notAtGateway.length}`);
        console.log('    Usually a boundary effect: captured just outside the range.');
        for (const row of notAtGateway) {
            console.log(`    order ${row.order_id}   ${row.transaction_id}   ${paise(row.amount_paise)}   ${when(row.created_at)}`);
        }
    }

    if (uncaptured.length) {
        console.log(`\n  AUTHORISED, NEVER CAPTURED — ${uncaptured.length}`);
        console.log('    Not money. Razorpay auto-refunds these after five days.');
        console.log('    A steady stream of them means payment_capture is not doing its job.');
        for (const payment of uncaptured) {
            console.log(`    ${payment.id}   ${paise(payment.amount)}   ${when(payment.created_at * 1000)}`);
        }
    }

    const clean = !missingHere.length && !mismatched.length;
    console.log('\n' + '-'.repeat(72));
    console.log(clean
        ? '  RECONCILED. Every captured payment in this window is recorded here.'
        : '  DISCREPANCIES ABOVE. Start with the MONEY MOVED block.');
    console.log('-'.repeat(72) + '\n');

    // A non-zero exit so this is usable from cron with a mail-on-failure rule.
    if (!clean) process.exit(2);
}

main().catch(error => {
    console.error('\nReconciliation failed:', error.message, '\n');
    process.exit(1);
});
