const { round2 } = require('../../../shared/money');
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

    let itemTaxAssigned = 0;
    const lines = (items || []).map((item, index) => {
        const lineTaxable = money(item.total_amount === null || item.total_amount === undefined
            ? Number(item.price || 0) * Number(item.quantity || 0)
            : item.total_amount);
        const lineTax = money(lineTaxable * taxRate);
        itemTaxAssigned = money(itemTaxAssigned + lineTax);
        const split = taxType === 'CGST_SGST';
        const cgst = split ? money(lineTax / 2) : 0;
        const sgst = split ? money(lineTax - cgst) : 0;

        return {
            position: index + 1,
            product_id: item.product_id,
            description: item.product_name || 'Product',
            quantity: Number(item.quantity || 0),
            unit_price: money(item.price),
            taxable_value: lineTaxable,
            gst_rate_percent: round2(taxRate * 100),
            cgst_amount: cgst,
            sgst_amount: sgst,
            igst_amount: split ? 0 : lineTax,
            line_total: money(lineTaxable + lineTax)
        };
    });

    const splitTax = taxType === 'CGST_SGST';
    const cgst = splitTax ? money(totalTax / 2) : 0;
    const sgst = splitTax ? money(totalTax - cgst) : 0;
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
            shipping_gst: money(totalTax - itemTaxAssigned),
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
