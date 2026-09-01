// =============================================================================
// invoice-rounding.test.js — F11: buildOrderInvoice() rounds tax exactly once
// =============================================================================
//
// A pure-function unit test, not an HTTP one: order-invoice.service.js takes
// a frozen order/items/shipping/payment shape and returns a plain object,
// with no database and no server to boot. Run directly by test/run.js
// alongside the two HTTP suites.
//
// THE BUG THIS GUARDS AGAINST
// ----------------------------
// Each invoice line's tax used to be rounded to 2dp on its own, and whatever
// was left over after summing the (already-rounded) lines was assigned to
// shipping as `totalTax - itemTaxAssigned`. Two ₹1.03 lines at 18% GST have
// ₹0.185 tax each — 18.5 paise — which the old code rounded to ₹0.19 apiece,
// summing to ₹0.38 against a frozen header total of ₹0.37. Shipping then
// absorbed the -₹0.01 difference, going NEGATIVE on an order with zero
// shipping. The fix allocates the frozen header total across every taxable
// line AND actual shipping in one integer-paise, largest-remainder pass, so
// the lines (plus shipping) always sum to exactly the frozen total.
// =============================================================================
const { buildOrderInvoice } = require('../src/modules/orders/services/order-invoice.service');

let pass = 0, fail = 0;
const failures = [];
function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

const SELLER_STATE = 'Haryana';

function order(overrides) {
    return Object.assign({
        id: 1,
        order_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        invoice_issued_at: '2026-01-01T00:00:00Z',
        invoice_number: 'INV-20260101-000001',
        status: 'Processing',
        currency: 'INR',
        tax_type: 'CGST_SGST',
        place_of_supply: SELLER_STATE,
        seller_legal_name: 'Pooja Rani',
        seller_gstin: '06DOCPR1264G1Z0',
        seller_state: SELLER_STATE,
        buyer_name: 'Test Buyer',
        buyer_email: 'buyer@example.test'
    }, overrides);
}

const shipping = { state: SELLER_STATE };

console.log('\n=== F11: invoice tax rounding ===\n');

// ---- 1. THE EXACT CASE FROM THE AUDIT --------------------------------------
//
// Two lines at ₹1.03 each (₹2.06 taxable), 18% GST -> ₹0.3708 tax, frozen on
// the header as ₹0.37. Zero shipping. The old code produced item_gst 0.38,
// shipping_gst -0.01, and lines summing to 2.44 against a 2.43 total.
{
    const o = order({ amount: 2.06, shipping_amount: 0, tax_amount: 0.37, tax_rate: 0.18, net_amount: 2.43 });
    const items = [
        { product_id: 1, product_name: 'Line A', price: 1.03, quantity: 1, total_amount: 1.03 },
        { product_id: 2, product_name: 'Line B', price: 1.03, quantity: 1, total_amount: 1.03 }
    ];

    const invoice = buildOrderInvoice({ order: o, items, shipping, payment: null });

    check('shipping GST is zero, not negative, on a zero-shipping order',
        invoice.totals.shipping_gst === 0, JSON.stringify(invoice.totals));

    const lineTaxSum = invoice.items.reduce((sum, line) => sum + line.cgst_amount + line.sgst_amount + line.igst_amount, 0);
    check('line tax sums to exactly the frozen header GST (37 paise)',
        Math.round(lineTaxSum * 100) === 37, `line tax sum = ${lineTaxSum}, expected 0.37`);

    const lineTotalSum = invoice.items.reduce((sum, line) => sum + line.line_total, 0);
    check('line totals sum to exactly the frozen grand total',
        Math.round(lineTotalSum * 100) === Math.round(o.net_amount * 100),
        `line total sum = ${lineTotalSum}, expected ${o.net_amount}`);

    check('item_gst + shipping_gst equals the frozen header GST exactly',
        Math.round((invoice.totals.item_gst + invoice.totals.shipping_gst) * 100) === 37,
        JSON.stringify(invoice.totals));

    check('cgst + sgst equals the frozen header GST exactly',
        Math.round((invoice.totals.cgst + invoice.totals.sgst) * 100) === 37,
        JSON.stringify(invoice.totals));

    const lineCgstSum = invoice.items.reduce((sum, line) => sum + line.cgst_amount, 0);
    const lineSgstSum = invoice.items.reduce((sum, line) => sum + line.sgst_amount, 0);
    check('line CGST sums to header CGST, and line SGST sums to header SGST, SEPARATELY',
        Math.round(lineCgstSum * 100) === Math.round(invoice.totals.cgst * 100) &&
        Math.round(lineSgstSum * 100) === Math.round(invoice.totals.sgst * 100),
        `lineCgstSum=${lineCgstSum} headerCgst=${invoice.totals.cgst}, lineSgstSum=${lineSgstSum} headerSgst=${invoice.totals.sgst}`);
}

// ---- 2. REAL SHIPPING IS A REAL WEIGHT, NOT A BUCKET -----------------------
//
// Shipping GST must reflect ACTUAL shipping charged, proportionally, not
// silently absorb the rounding leftover from the lines.
{
    const o = order({ amount: 1000, shipping_amount: 1500, tax_amount: 450, tax_rate: 0.18, net_amount: 2950 });
    const items = [{ product_id: 1, product_name: 'Machine', price: 1000, quantity: 1, total_amount: 1000 }];

    const invoice = buildOrderInvoice({ order: o, items, shipping, payment: null });

    // Taxable value: 1000 goods + 1500 shipping = 2500. Shipping is 60% of
    // that, so shipping's share of ₹450 GST should be ₹270 (18% of 1500),
    // not zero and not whatever is left over.
    check('shipping GST is a real proportional share of actual shipping, not zero',
        invoice.totals.shipping_gst === 270, JSON.stringify(invoice.totals));
    check('item GST is the remaining real share, not the whole header total',
        invoice.totals.item_gst === 180, JSON.stringify(invoice.totals));
    check('item_gst + shipping_gst still equals the frozen header GST exactly',
        invoice.totals.item_gst + invoice.totals.shipping_gst === 450, JSON.stringify(invoice.totals));
}

// ---- 3. MANY LINES, AN AWKWARD TOTAL — every largest-remainder edge -------
{
    const o = order({ amount: 30, shipping_amount: 0, tax_amount: 0.5, tax_rate: 1 / 6, net_amount: 30.5 });
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
        product_id: n, product_name: `Line ${n}`, price: 3, quantity: 1, total_amount: 3
    }));

    const invoice = buildOrderInvoice({ order: o, items, shipping, payment: null });

    const lineTaxSum = invoice.items.reduce((sum, line) => sum + line.cgst_amount + line.sgst_amount + line.igst_amount, 0);
    check('ten lines against a 50-paise header: line tax still sums exactly',
        Math.round(lineTaxSum * 100) === 50, `sum=${lineTaxSum}`);
    check('...and shipping GST is zero, not a fractional leftover',
        invoice.totals.shipping_gst === 0, JSON.stringify(invoice.totals));

    const lineTotalSum = invoice.items.reduce((sum, line) => sum + line.line_total, 0);
    check('...and line totals sum to exactly the frozen grand total',
        Math.round(lineTotalSum * 100) === Math.round(o.net_amount * 100),
        `sum=${lineTotalSum} expected=${o.net_amount}`);
}

// ---- 4. IGST (inter-state): one component, not split into CGST/SGST -------
{
    const o = order({
        amount: 2.06, shipping_amount: 0, tax_amount: 0.37, tax_rate: 0.18, net_amount: 2.43,
        tax_type: 'IGST', place_of_supply: 'Delhi'
    });
    const items = [
        { product_id: 1, product_name: 'Line A', price: 1.03, quantity: 1, total_amount: 1.03 },
        { product_id: 2, product_name: 'Line B', price: 1.03, quantity: 1, total_amount: 1.03 }
    ];

    const invoice = buildOrderInvoice({ order: o, items, shipping: { state: 'Delhi' }, payment: null });

    check('IGST orders carry no CGST/SGST at header level',
        invoice.totals.cgst === 0 && invoice.totals.sgst === 0 && invoice.totals.igst === 0.37,
        JSON.stringify(invoice.totals));
    const lineIgstSum = invoice.items.reduce((sum, line) => sum + line.igst_amount, 0);
    check('...and line IGST sums to exactly the frozen header IGST',
        Math.round(lineIgstSum * 100) === 37, `sum=${lineIgstSum}`);
    const noCgstSgstOnLines = invoice.items.every((line) => line.cgst_amount === 0 && line.sgst_amount === 0);
    check('...and no line carries a CGST/SGST amount on an IGST invoice',
        noCgstSgstOnLines, JSON.stringify(invoice.items));
}

// ---- 5. ZERO TAX IS STILL EXACT, NOT A DIVIDE-BY-ZERO ----------------------
{
    const o = order({ amount: 100, shipping_amount: 0, tax_amount: 0, tax_rate: 0, net_amount: 100 });
    const items = [{ product_id: 1, product_name: 'Exempt', price: 100, quantity: 1, total_amount: 100 }];

    const invoice = buildOrderInvoice({ order: o, items, shipping, payment: null });
    check('zero header tax produces zero everywhere, without throwing',
        invoice.totals.item_gst === 0 && invoice.totals.shipping_gst === 0 &&
        invoice.items[0].cgst_amount === 0 && invoice.items[0].sgst_amount === 0,
        JSON.stringify(invoice.totals));
}

// ---- 6. TAX AGAINST NOTHING IS A REFUSAL, NOT A SILENT ZERO ---------------
//
// A nonzero frozen header tax with every taxable weight (lines AND shipping)
// at zero is a contradiction — tax charged against nothing — and
// allocatePaise() is built to refuse it loudly rather than let it produce a
// misleading invoice.
{
    const o = order({ amount: 0, shipping_amount: 0, tax_amount: 0.10, tax_rate: 0, net_amount: 0.10 });
    const items = [{ product_id: 1, product_name: 'Free sample', price: 0, quantity: 1, total_amount: 0 }];

    let threw = false;
    try {
        buildOrderInvoice({ order: o, items, shipping, payment: null });
    } catch (error) {
        threw = true;
    }
    check('tax charged against zero taxable value is refused, not silently allocated',
        threw, 'buildOrderInvoice did not throw');
}

console.log('\n' + '='.repeat(64));
console.log(`INVOICE ROUNDING: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  - ' + f)); }
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
