/*
 * The legal identity written into customer financial records.
 *
 * This is shared contract data because checkout freezes it onto the order and
 * the orders module uses it only as an explicit fallback for records created
 * before invoice snapshots existed. Keep it in step with the public legal
 * pages and bank/KYC records.
 */
const SELLER = Object.freeze({
    legal_name: 'Pooja Rani',
    trade_name: 'SRK Team Star',
    gstin: '06DOCPR1264G1Z0',
    address: 'Behind New ITI, Rohtak Road, Near Water Boosting Station, Gohana, Sonipat, Haryana 131301, India',
    state: 'Haryana',
    state_code: '06',
    email: 'srkteamstar@gmail.com',
    phone: '+91 90500 09442',
    website: 'www.srkteamstar.com'
});

module.exports = { SELLER };
