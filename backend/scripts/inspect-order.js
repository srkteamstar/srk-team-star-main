#!/usr/bin/env node
// =============================================================================
// inspect-order.js — what actually happened to an order, end to end
// =============================================================================
//
//   node scripts/inspect-order.js            # the most recent order
//   node scripts/inspect-order.js 12         # that order
//   node scripts/inspect-order.js --watch    # poll the latest, for testing
//
// WHY THIS EXISTS
// ---------------
// After a test payment the browser says "Order placed", and that sentence is
// worth exactly nothing on its own — it is the same screen whether the money
// moved or not. Four separate records have to agree before a payment is real:
//
//   orders.status            'Processing'  (was 'Pending Payment')
//   payments.status          'Paid'
//   payments.verified_at     set — markOrderPaid() asked the gateway itself
//   payment_events           a signature_verified delivery, processed
//
// This prints all four and says whether they agree. The most useful thing it
// can tell you is the case where they DISAGREE: a payment verified by the
// browser callback with no webhook behind it means the webhook is not
// arriving, which is invisible in the storefront and is the exact failure that
// loses money later, when a customer pays and closes the tab.
//
// READ ONLY. Nothing here writes; it is safe against the live project.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const wanted = args.find(a => /^\d+$/.test(a));

const rupees = (v) => (v === null || v === undefined ? '—' : '₹ ' + Number(v).toLocaleString('en-IN'));
const when = (v) => (v ? new Date(v).toLocaleString() : '—');

async function report() {
    let order;

    if (wanted) {
        const { data, error } = await db.from('orders').select('*').eq('id', wanted).maybeSingle();
        if (error) throw error;
        order = data;
        if (!order) return console.log(`\nNo order with id ${wanted}.\n`);
    } else {
        const { data, error } = await db.from('orders').select('*').order('id', { ascending: false }).limit(1);
        if (error) throw error;
        order = (data || [])[0];
        if (!order) {
            console.log('\nNo orders yet. Place one at http://localhost:' + (process.env.PORT || 3000) + '/store/store.html\n');
            return;
        }
    }

    const [items, payments, events] = await Promise.all([
        db.from('order_items').select('*').eq('order_id', order.id),
        db.from('payments').select('*').eq('order_id', order.id).order('id', { ascending: true }),
        db.from('payment_events').select('*').eq('order_id', order.id).order('id', { ascending: true })
    ]);

    const pay = (payments.data || [])[(payments.data || []).length - 1] || null;

    console.log('\n' + '='.repeat(66));
    console.log(`ORDER ${order.id}   ORD-${new Date(order.created_at).getFullYear()}-${order.order_number}`);
    console.log('='.repeat(66));
    console.log('  placed        ' + when(order.created_at));
    console.log('  status        ' + order.status);
    console.log('  goods         ' + rupees(order.amount));
    console.log('  delivery      ' + rupees(order.shipping_amount));
    console.log('  GST           ' + rupees(order.tax_amount));
    console.log('  NET           ' + rupees(order.net_amount));

    // The four money columns must reconcile, or the invoice cannot be rebuilt.
    const sum = Number(order.amount) + Number(order.shipping_amount) + Number(order.tax_amount);
    const reconciles = Math.abs(sum - Number(order.net_amount)) < 0.005;
    console.log('  reconciles    ' + (reconciles ? 'yes' : `NO — ${sum} != ${order.net_amount}`));

    console.log('\n  ITEMS');
    (items.data || []).forEach(i =>
        console.log(`    ${i.quantity} x ${String(i.product_name).slice(0, 40).padEnd(42)} ${rupees(i.total_amount)}`));

    console.log('\n  PAYMENT');
    if (!pay) {
        console.log('    (none)');
    } else {
        console.log('    status            ' + pay.status);
        console.log('    gateway           ' + (pay.gateway || '—'));
        console.log('    method            ' + (pay.payment_method || '—'));
        console.log('    amount_paise      ' + pay.amount_paise + '   (' + rupees(pay.amount_paise / 100) + ')');
        console.log('    currency          ' + pay.currency);
        console.log('    gateway_order_id  ' + (pay.gateway_order_id || '—'));
        console.log('    transaction_id    ' + (pay.transaction_id || '—'));
        console.log('    verified_at       ' + when(pay.verified_at));

        // The exactness that makes check 2 of markOrderPaid() meaningful.
        const expected = Math.round((Number(order.net_amount) + Number.EPSILON) * 100);
        console.log('    paise match       ' +
            (pay.amount_paise === expected ? 'yes' : `NO — order says ${expected}`));
    }

    console.log('\n  WEBHOOK DELIVERIES FOR THIS ORDER');
    if (!(events.data || []).length) {
        console.log('    (none linked to this order)');
    } else {
        (events.data || []).forEach(e => console.log(
            `    ${String(e.event_type).padEnd(20)} verified=${e.signature_verified}` +
            `  processed=${e.processed_at ? 'yes' : 'no'}` +
            (e.process_error ? `  note="${e.process_error}"` : '')));
    }

    // ---- The verdict ---------------------------------------------------
    console.log('\n' + '-'.repeat(66));

    const paid = pay && pay.status === 'Paid';
    const verified = pay && pay.verified_at;
    const goodWebhook = (events.data || []).some(e =>
        e.signature_verified && ['payment.captured', 'order.paid'].includes(e.event_type));

    if (paid && verified && goodWebhook) {
        console.log('  PAID, VERIFIED AGAINST THE GATEWAY, AND CONFIRMED BY WEBHOOK.');
        console.log('  This is the fully working state. Nothing outstanding.');
    } else if (paid && verified && !goodWebhook) {
        console.log('  PAID and verified — but NO verified webhook arrived for it.');
        console.log('  The browser callback did the work. That is fine for THIS order and');
        console.log('  is a problem for the next one: a customer who pays and closes the');
        console.log('  tab has no callback, and only the webhook would settle it.');
        console.log('  -> Check Razorpay Dashboard > Webhooks > delivery log for failures,');
        console.log('     and that the tunnel URL there is the one currently running.');
    } else if (order.status === 'Pending Payment') {
        console.log('  AWAITING PAYMENT. The order exists and is unpaid — which is the');
        console.log('  correct state after closing the modal without paying.');
    } else if (order.status === 'Cancelled') {
        // Two different failures land here and the payment row tells them
        // apart: the detail write (items / address / payments) failing leaves
        // no payment row at all, while a Razorpay order creation failure
        // leaves one marked Failed. Both mean nothing was charged — the order
        // is cancelled rather than left looking placed — but they are fixed in
        // different places, so the verdict should not guess.
        console.log('  CANCELLED — nothing was charged.');
        console.log(pay
            ? '  A payment row exists, so the order was written and creating the\n' +
              '  Razorpay order failed. Usually a wrong RAZORPAY_KEY_SECRET.'
            : '  No payment row, so the write of items / address / payments failed\n' +
              '  before the gateway was ever contacted. The server log names the\n' +
              '  column or constraint.');
    } else {
        console.log('  MIXED STATE — read the rows above.');
    }
    console.log('-'.repeat(66) + '\n');
}

(async () => {
    if (!watch) return report().catch(e => { console.error(e.message); process.exit(1); });

    console.log('Watching for the newest order. Ctrl+C to stop.');
    let last = null;
    for (;;) {
        const { data } = await db.from('orders').select('id,status,updated_at').order('id', { ascending: false }).limit(1);
        const row = (data || [])[0];
        const stamp = row ? `${row.id}:${row.status}` : 'none';
        if (stamp !== last) { last = stamp; await report(); }
        await new Promise(r => setTimeout(r, 3000));
    }
})();
