const { round2, toPaiseBig, fromPaiseBig, allocatePaise } = require('../../../shared/money');
const { PAYMENT_STATUS, CURRENCY } = require('../../../shared/contracts/payment');
const { SELLER } = require('../../../shared/contracts/seller');
const { gstTreatment } = require('../../../shared/indian-gst');
const { orderReference } = require('../../../shared/contracts/order-reference');
const { invoiceReference } = require('../domain/invoice-reference');
const { moneyInWords } = require('../domain/money-in-words');

const money = (value) => round2(Number(value || 0));

function sellerFor(order) {
    const snapshotted = Boolean(order.seller_legal_name && order.seller_gstin);
    return {
        legal_name: order.seller_legal_name || SELLER.legal_name,
        trade_name: order.seller_trade_name || SELLER.trade_name,
        gstin: order.seller_gstin || SELLER.gstin,
        address: order.seller_address || SELLER.address,
        state: order.seller_state || SELLER.state,
        state_code: SELLER.state_code,
        email: order.seller_email || SELLER.email,
        phone: order.seller_phone || SELLER.phone,
        website: SELLER.website,
        snapshot_source: snapshotted ? 'order' : 'current_business_record_for_historical_order'
    };
}

function addressShape(row) {
    if (!row) return null;
    return {
        address_line: row.full_address || null,
        city: row.city || null,
        state: row.state || null,
        postal_code: row.zip_code || null,
        country: row.country || null
    };
}

function buildOrderInvoice({ order, items, shipping, payment }) {
    const seller = sellerFor(order);
    const shippingAddress = addressShape(shipping);
    const subtotal = money(order.amount);
    const shippingAmount = money(order.shipping_amount);
    const taxableValue = money(subtotal + shippingAmount);
    const totalTax = money(order.tax_amount);
    const grandTotal = money(order.net_amount);
    const storedRate = Number(order.tax_rate);
    const taxRate = Number.isFinite(storedRate) && storedRate >= 0
        ? storedRate
        : (taxableValue ? totalTax / taxableValue : 0);
    const taxType = order.tax_type || gstTreatment(seller.state, shipping && shipping.state);
    const splitTax = taxType === 'CGST_SGST';

    // ---- The frozen header tax (order.tax_amount — never recomputed here),
    // allocated across every taxable line AND actual shipping in one pass.
    //
    // This used to round each line's tax independently and hand shipping
    // whatever was left over after summing them — which could and did go
    // negative on a zero-shipping order, and could leave the lines summing
    // to something other than the frozen total. Rounding a frozen figure has
    // to happen once, in integer paise, with a largest-remainder allocation
    // — see allocatePaise() in shared/money.js. CGST and SGST are allocated
    // SEPARATELY (not "total tax, then halved per line") so both their own
    // line sums and their own header totals agree exactly, not just their
    // combination.
    const lineTaxableAmounts = (items || []).map((item) => money(
        item.total_amount === null || item.total_amount === undefined
            ? Number(item.price || 0) * Number(item.quantity || 0)
            : item.total_amount
    ));
    const weights = [...lineTaxableAmounts, shippingAmount].map(toPaiseBig);
    const totalTaxPaise = toPaiseBig(totalTax);

    // The header CGST/SGST split, in paise, decided once before either
    // component is allocated across the weights above. The extra paise on
    // an odd total goes to CGST — this file's existing convention.
    const cgstHeaderPaise = splitTax ? (totalTaxPaise + 1n) / 2n : 0n;
    const sgstHeaderPaise = splitTax ? totalTaxPaise - cgstHeaderPaise : 0n;

    const cgstShares = splitTax ? allocatePaise(cgstHeaderPaise, weights) : weights.map(() => 0n);
    const sgstShares = splitTax ? allocatePaise(sgstHeaderPaise, weights) : weights.map(() => 0n);
    const igstShares = splitTax ? weights.map(() => 0n) : allocatePaise(totalTaxPaise, weights);

    const lines = (items || []).map((item, index) => {
        const lineTaxable = lineTaxableAmounts[index];
        const cgstAmt = fromPaiseBig(cgstShares[index]);
        const sgstAmt = fromPaiseBig(sgstShares[index]);
        const igstAmt = fromPaiseBig(igstShares[index]);
        const lineTax = money(cgstAmt + sgstAmt + igstAmt);

        return {
            position: index + 1,
            product_id: item.product_id,
            description: item.product_name || 'Product',
            quantity: Number(item.quantity || 0),
            unit_price: money(item.price),
            taxable_value: lineTaxable,
            gst_rate_percent: round2(taxRate * 100),
            cgst_amount: cgstAmt,
            sgst_amount: sgstAmt,
            igst_amount: igstAmt,
            line_total: money(lineTaxable + lineTax)
        };
    });

    // Shipping is the LAST weight, and its share of tax is read from the
    // same allocation the lines came from — a real weight in the split, not
    // an unexplained bucket that absorbs whatever the lines did not use.
    const shippingIdx = weights.length - 1;
    const shippingGstPaise = cgstShares[shippingIdx] + sgstShares[shippingIdx] + igstShares[shippingIdx];
    const itemGstPaise = lineTaxableAmounts.reduce(
        (sum, _amount, index) => sum + cgstShares[index] + sgstShares[index] + igstShares[index],
        0n
    );

    const shippingGst = fromPaiseBig(shippingGstPaise);
    const itemTaxAssigned = fromPaiseBig(itemGstPaise);
    const cgst = fromPaiseBig(cgstHeaderPaise);
    const sgst = fromPaiseBig(sgstHeaderPaise);
    const paymentStatus = payment ? payment.status : 'Not recorded';
    const buyerSnapshotted = Boolean(order.buyer_name && order.buyer_email);
    const issuedAt = order.invoice_issued_at || order.created_at;

    return {
        schema_version: 1,
        invoice: {
            number: invoiceReference(order),
            issued_at: issuedAt,
            order_id: order.id,
            order_reference: orderReference(order),
            order_status: order.status || 'Processing',
            currency: order.currency || (payment && payment.currency) || CURRENCY,
            place_of_supply: order.place_of_supply || (shipping && shipping.state) || null,
            tax_type: taxType
        },
        seller,
        buyer: {
            name: order.buyer_name || 'Not captured on this historical order',
            company: order.buyer_company || null,
            email: order.buyer_email || null,
            phone: order.buyer_phone || null,
            billing_address: shippingAddress,
            billing_address_note: 'A separate billing address was not collected; the frozen delivery address is used.'
        },
        shipping_address: shippingAddress,
        items: lines,
        totals: {
            subtotal,
            shipping: shippingAmount,
            taxable_value: taxableValue,
            item_gst: itemTaxAssigned,
            shipping_gst: shippingGst,
            cgst,
            sgst,
            igst: splitTax ? 0 : totalTax,
            gst: totalTax,
            grand_total: grandTotal
        },
        payment: {
            status: paymentStatus,
            paid: paymentStatus === PAYMENT_STATUS.paid,
            method: payment ? (payment.payment_method || null) : null,
            gateway: payment ? (payment.gateway || null) : null,
            transaction_reference: payment ? (payment.transaction_id || payment.gateway_order_id || null) : null,
            verified_at: payment ? (payment.verified_at || null) : null,
            updated_at: payment ? (payment.updated_at || payment.created_at || null) : null
        },
        amount_in_words: moneyInWords(grandTotal),
        snapshot: {
            complete: Boolean(order.invoice_number && buyerSnapshotted && seller.snapshot_source === 'order'),
            note: order.invoice_number && buyerSnapshotted
                ? null
                : 'This order predates one or more invoice snapshot fields; missing values are identified rather than read from the customer’s current profile.'
        }
    };
}

module.exports = { buildOrderInvoice };
