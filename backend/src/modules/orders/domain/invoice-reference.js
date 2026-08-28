const pad = (value, length) => String(value).padStart(length, '0');

function invoiceReference(order) {
    if (order && order.invoice_number) return String(order.invoice_number);

    const date = new Date(order && order.created_at);
    const validDate = !Number.isNaN(date.getTime());
    const stamp = validDate
        ? `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`
        : 'HISTORICAL';
    const sequence = order && (order.order_number ?? order.id);
    return `INV-${stamp}-${pad(sequence || 0, 6)}`;
}

module.exports = { invoiceReference };
