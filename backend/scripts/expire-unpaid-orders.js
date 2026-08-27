#!/usr/bin/env node
// =============================================================================
// expire-unpaid-orders.js — close out orders nobody ever paid for
// =============================================================================
//
//   node scripts/expire-unpaid-orders.js                 # DRY RUN, the default
//   node scripts/expire-unpaid-orders.js --apply         # actually cancel them
//   node scripts/expire-unpaid-orders.js --hours=48      # a different window
//   node scripts/expire-unpaid-orders.js --apply --hours=72
//
// WHY THIS EXISTS
// ---------------
// An order placed through the gateway opens in 'Pending Payment' and stays
// there until markOrderPaid() moves it. Nothing else ever did. So every
// abandoned payment — a closed tab, a UPI app that never came back, a customer
// who changed their mind — left a permanent row that:
//
//   holds a real order_number out of the sequence, forever;
//   sits in the admin list looking like an order to fulfil;
//   counts toward any "orders this month" figure anyone ever writes.
//
// The customer can now close one out themselves (POST /api/orders/:id/cancel)
// and can resume paying for it from their order history. This is the sweep for
// the ones nobody comes back to at all.
//
// WHY A SCRIPT AND NOT A setInterval IN server.js
// -----------------------------------------------
// A timer inside the web process would be simpler to deploy and worse in three
// ways. It writes to the live database on a schedule nobody asked for, which is
// exactly the class of surprise this repository has avoided everywhere else —
// the three scripts beside this one are all operator-invoked. It also runs once
// per process, so the day this is ever run on two instances it sweeps twice
// concurrently. And it cannot be dry-run: the first time you would find out
// what it does is by reading what it did.
//
// Run it from cron, Task Scheduler, or by hand. Nothing depends on it having
// run — it only tidies.
//
// WHAT IT WILL NOT TOUCH
// ----------------------
// Four guards, and the third and fourth are the ones that matter:
//
//   1. status must be exactly 'Pending Payment'
//   2. created_at must be older than the window (default 24h)
//   3. the payment row must not be 'Paid'
//   4. RAZORPAY ITSELF MUST REPORT NO MONEY AGAINST THE ORDER
//
// Guard 4 is not paranoia about guard 3. Our own row is only as current as the
// last webhook we processed, and the entire reason a webhook might not have
// been processed is the reason this script exists. Sweeping on our own records
// alone would cancel precisely the orders whose payment we failed to record —
// the worst possible selection bias. An order the gateway cannot be asked about
// is SKIPPED, not cancelled.
//
// DRY RUN IS THE DEFAULT. --apply is required to write anything.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const razorpay = require('../src/core/gateways/razorpay');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const hoursArg = args.find(a => a.startsWith('--hours='));
const HOURS = hoursArg ? Number(hoursArg.split('=')[1]) : 24;

const PAYMENTS_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_ENABLED || '').trim());

if (!Number.isFinite(HOURS) || HOURS < 1) {
    console.error(`--hours must be a number of at least 1. Got "${hoursArg}".`);
    process.exit(1);
}

const when = (v) => (v ? new Date(v).toLocaleString() : '—');
const rupees = (v) => (v === null || v === undefined ? '—' : '₹ ' + Number(v).toLocaleString('en-IN'));

async function main() {
    const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString();

    console.log('\n' + '='.repeat(70));
    console.log(`  UNPAID ORDER SWEEP  ${apply ? '(APPLYING)' : '(dry run — pass --apply to write)'}`);
    console.log(`  Cancelling 'Pending Payment' orders created before ${when(cutoff)}`);
    console.log('='.repeat(70));

    const { data: orders, error } = await db
        .from('orders')
        .select('*')
        .eq('status', 'Pending Payment')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true });

    if (error) throw error;

    if (!orders || orders.length === 0) {
        console.log('\n  Nothing to sweep. No unpaid orders older than the window.\n');
        return;
    }

    console.log(`\n  ${orders.length} candidate${orders.length === 1 ? '' : 's'}.\n`);

    // One query for every candidate's payments rather than one per order.
    const ids = orders.map(o => o.id);
    const { data: payments, error: payError } = await db
        .from('payments').select('*').in('order_id', ids);
    if (payError) throw payError;

    // Most recent per order — the same rule gatewayPaymentRow() uses.
    const paymentByOrder = new Map();
    (payments || []).forEach(p => {
        const key = String(p.order_id);
        const seen = paymentByOrder.get(key);
        if (!seen || new Date(p.created_at || 0) > new Date(seen.created_at || 0)) {
            paymentByOrder.set(key, p);
        }
    });

    let cancelled = 0;
    let skipped = 0;

    for (const order of orders) {
        const payment = paymentByOrder.get(String(order.id)) || null;
        const label = `  #${order.order_number} (id ${order.id}, ${rupees(order.net_amount)}, placed ${when(order.created_at)})`;

        // ---- Guard 3.
        if (payment && payment.status === 'Paid') {
            console.log(`${label}\n      SKIP — the payment row says Paid. The order status is stale; fix that instead.`);
            skipped += 1;
            continue;
        }

        // ---- Guard 4.
        if (payment && payment.gateway === 'razorpay' && payment.gateway_order_id) {
            if (!PAYMENTS_ENABLED || !razorpay.isConfigured()) {
                console.log(`${label}\n      SKIP — gateway order ${payment.gateway_order_id}, but this environment has no Razorpay keys to check it with.`);
                skipped += 1;
                continue;
            }

            let gatewayOrder;
            try {
                gatewayOrder = await razorpay.fetchOrder(payment.gateway_order_id);
            } catch (gatewayError) {
                console.log(`${label}\n      SKIP — could not reach Razorpay: ${gatewayError.message}`);
                skipped += 1;
                continue;
            }

            if (Number(gatewayOrder.amount_paid) > 0 || gatewayOrder.status === 'paid') {
                console.log(
                    `${label}\n      SKIP — RAZORPAY HAS ${gatewayOrder.amount_paid} PAISE AGAINST THIS ORDER.\n` +
                    `      This order was paid for and we never recorded it. Run scripts/reconcile.js.`
                );
                skipped += 1;
                continue;
            }
        }

        if (!apply) {
            console.log(`${label}\n      would cancel`);
            cancelled += 1;
            continue;
        }

        // Guarded on the status in the WHERE clause, not in JavaScript above:
        // the round trip to Razorpay took time, and a webhook may have landed
        // during it. This is the only check that is atomic with the write.
        const { data: updated, error: updateError } = await db
            .from('orders')
            .update({ status: 'Cancelled' })
            .eq('id', order.id)
            .eq('status', 'Pending Payment')
            .select()
            .maybeSingle();

        if (updateError) {
            console.log(`${label}\n      FAILED — ${updateError.message}`);
            skipped += 1;
            continue;
        }

        if (!updated) {
            console.log(`${label}\n      SKIP — it moved while we were checking. Almost certainly it just got paid.`);
            skipped += 1;
            continue;
        }

        console.log(`${label}\n      cancelled`);
        cancelled += 1;
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`  ${apply ? 'Cancelled' : 'Would cancel'}: ${cancelled}    Skipped: ${skipped}`);
    if (!apply && cancelled > 0) console.log('  Re-run with --apply to write these.');
    console.log('-'.repeat(70) + '\n');
}

main().catch(error => {
    console.error('\nSweep failed:', error.message, '\n');
    process.exit(1);
});
