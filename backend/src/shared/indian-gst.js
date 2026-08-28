function normaliseState(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, '');
}

function gstTreatment(sellerState, buyerState) {
    const seller = normaliseState(sellerState);
    const buyer = normaliseState(buyerState);

    // A missing buyer state is not enough evidence to claim an intra-state
    // supply. The caller can surface this as an incomplete historical record.
    if (!seller || !buyer) return 'IGST';
    return seller === buyer ? 'CGST_SGST' : 'IGST';
}

module.exports = { normaliseState, gstTreatment };
