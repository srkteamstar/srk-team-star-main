const ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underHundred(value) {
    if (value < 20) return ONES[value];
    return [TENS[Math.floor(value / 10)], ONES[value % 10]].filter(Boolean).join(' ');
}

function underThousand(value) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? underHundred(rest) : '']
        .filter(Boolean).join(' ');
}

function wholeRupees(value) {
    if (value === 0) return 'Zero';

    const groups = [
        [10000000, 'Crore'],
        [100000, 'Lakh'],
        [1000, 'Thousand']
    ];
    let remaining = value;
    const words = [];

    groups.forEach(([size, label]) => {
        const count = Math.floor(remaining / size);
        if (!count) return;
        words.push(`${underThousand(count)} ${label}`);
        remaining %= size;
    });

    if (remaining) words.push(underThousand(remaining));
    return words.join(' ');
}

function moneyInWords(amount) {
    const paiseTotal = Math.round(Number(amount || 0) * 100);
    const rupees = Math.floor(paiseTotal / 100);
    const paise = paiseTotal % 100;
    return `Indian Rupees ${wholeRupees(rupees)}` +
        (paise ? ` and ${underHundred(paise)} Paise` : '') +
        ' Only';
}

module.exports = { moneyInWords };
