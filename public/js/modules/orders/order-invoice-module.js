/**
 * Customer purchase invoice viewer.
 *
 * The browser supplies only an order id. Everything printable is returned by
 * the owner-scoped invoice endpoint from frozen order rows; this module never
 * recomputes commercial totals or reads the mutable customer profile.
 */
(() => {
    'use strict';

    if (window.orderInvoice) return;

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('order-invoice-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const escapeHtml = chrome.escapeHtml;
    let handle = null;
    let activeOrderId = null;
    let activeOrderToken = null;

    const PRINT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/></svg>';
    const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9A7 7 0 0 1 18 6l2 5M3.9 13l2 5A7 7 0 0 0 18 15"/></svg>';

    function styles() {
        chrome.ensureStyles('order-invoice-styles', [
            '#order-invoice-overlay-scroll{background:#eef1ec}',
            '.invoice-stage{max-width:1120px;margin:0 auto;padding:28px 20px 64px}',
            '.invoice-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}',
            '.invoice-toolbar-note{font-size:12px;line-height:1.5;color:rgba(31,39,27,.62)}',
            '.invoice-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
            '.invoice-action{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border-radius:3px;border:1px solid rgba(18,23,15,.18);background:#fff;color:#12170f;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;transition:all .18s ease}',
            '.invoice-action:hover{background:#12170f;color:#fff}.invoice-action:hover svg{stroke:#fff}',
            '.invoice-action-primary{background:#4b071e;border-color:#4b071e;color:#fff!important}.invoice-action-primary span{color:#fff!important}.invoice-action-primary svg{color:#fff!important;stroke:#fff!important}',
            '.invoice-action:disabled{opacity:.5;cursor:wait}',
            '.purchase-invoice{width:210mm;max-width:100%;min-height:297mm;margin:0 auto;background:#fff;color:#162014;box-shadow:0 20px 60px rgba(18,23,15,.12);padding:14mm 14mm 12mm;font-family:Arial,Helvetica,sans-serif}',
            '.invoice-brand{display:flex;align-items:flex-start;justify-content:space-between;gap:28px;padding-bottom:18px;border-bottom:4px solid #4b071e}',
            '.invoice-logo{width:150px;height:auto;display:block}.invoice-brandline{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#8b6c16;margin-top:7px}',
            '.invoice-title{text-align:right}.invoice-title h1{margin:0;color:#4b071e;font-size:30px;letter-spacing:-.035em}.invoice-title p{margin:6px 0 0;font-size:11px;color:#53604f}',
            '.invoice-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #dfe4dc;border-top:0}',
            '.invoice-fact{padding:11px 12px;border-right:1px solid #dfe4dc}.invoice-fact:last-child{border-right:0}',
            '.invoice-label{display:block;margin-bottom:4px;color:#9a7616;font-size:8px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}',
            '.invoice-value{display:block;color:#12170f;font-size:11px;font-weight:700;line-height:1.45;overflow-wrap:anywhere}',
            '.invoice-payment{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 15px;margin:18px 0;background:#f5efe5;border-left:4px solid #d4af37}',
            '.invoice-payment-copy{min-width:0}.invoice-payment-title{margin:0;font-size:12px;font-weight:800;color:#12170f}.invoice-payment-meta{margin:3px 0 0;font-size:9px;line-height:1.5;color:#586253;overflow-wrap:anywhere}',
            '.invoice-badge{display:inline-flex;align-items:center;justify-content:center;min-width:90px;padding:7px 11px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;border:1px solid currentColor}',
            '.invoice-badge-paid{background:#edf8ef;color:#26703a}.invoice-badge-pending{background:#fff7df;color:#8a6500}.invoice-badge-failed{background:#fff0f0;color:#a83232}.invoice-badge-refunded{background:#eef4ff;color:#315d9a}',
            '.invoice-parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}',
            '.invoice-party{border:1px solid #dfe4dc;padding:14px;min-height:126px}.invoice-party h2{margin:0 0 10px;color:#9a7616;font-size:9px;letter-spacing:.12em;text-transform:uppercase}.invoice-party strong{display:block;font-size:12px;color:#12170f;margin-bottom:4px}.invoice-party p{margin:0;color:#52604f;font-size:9.5px;line-height:1.55;overflow-wrap:anywhere}',
            '.invoice-table{width:100%;border-collapse:collapse;margin-top:18px;font-size:9px}.invoice-table th{padding:9px 7px;background:#12170f;color:#fff;font-size:7.5px;letter-spacing:.08em;text-transform:uppercase;text-align:right}.invoice-table th:nth-child(1),.invoice-table th:nth-child(2){text-align:left}.invoice-table td{padding:10px 7px;border-bottom:1px solid #e2e6df;text-align:right;vertical-align:top}.invoice-table td:nth-child(1),.invoice-table td:nth-child(2){text-align:left}.invoice-table .invoice-description{font-weight:700;color:#12170f;font-size:9.5px}.invoice-table .invoice-item-id{display:block;margin-top:3px;color:#7c8678;font-size:7.5px;font-weight:400}',
            '.invoice-lower{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:24px;margin-top:18px;align-items:start}',
            '.invoice-words{padding:13px;background:#f6f7f4;border:1px solid #e1e5de}.invoice-words p{margin:3px 0 0;font-size:9.5px;font-weight:700;line-height:1.5;color:#12170f}',
            '.invoice-note{margin:12px 0 0;font-size:8px;line-height:1.55;color:#657061}',
            '.invoice-totals{width:100%;border-collapse:collapse;font-size:9px}.invoice-totals td{padding:6px 0;border-bottom:1px solid #e3e6df}.invoice-totals td:last-child{text-align:right;font-weight:700;color:#12170f}.invoice-totals .invoice-grand td{padding:9px 0;border-top:3px solid #4b071e;border-bottom:0;font-size:12px;font-weight:900;color:#4b071e}',
            '.invoice-signoff{display:grid;grid-template-columns:1fr 170px;gap:24px;align-items:end;margin-top:30px;padding-top:15px;border-top:1px solid #dfe4dc}.invoice-signoff p{margin:0;color:#667061;font-size:8px;line-height:1.55}.invoice-authority{text-align:center;padding-top:30px;border-top:1px solid #adb5a9;color:#12170f;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}',
            '.invoice-footer{margin-top:24px;padding:7px 10px;background:#12170f;color:#fff;text-align:center;font-size:7px;letter-spacing:.04em}',
            '.invoice-history-note{max-width:210mm;margin:0 auto 12px;padding:10px 12px;background:#fff8df;border:1px solid #ead58f;color:#725814;font-size:10px;line-height:1.5}',
            '@media(max-width:720px){.invoice-stage{padding:18px 10px 42px}.invoice-toolbar{align-items:flex-start;flex-direction:column}.invoice-actions{width:100%}.invoice-action{flex:1}.purchase-invoice{width:100%;min-height:0;padding:22px 16px}.invoice-brand{gap:14px}.invoice-logo{width:112px}.invoice-title h1{font-size:21px}.invoice-facts{grid-template-columns:1fr 1fr}.invoice-fact:nth-child(2){border-right:0}.invoice-fact:nth-child(-n+2){border-bottom:1px solid #dfe4dc}.invoice-parties{grid-template-columns:1fr}.invoice-table-wrap{overflow-x:auto}.invoice-table{min-width:690px}.invoice-lower{grid-template-columns:1fr}.invoice-signoff{grid-template-columns:1fr}}',
            '@page{size:A4;margin:10mm}',
            '@media print{html{background:#fff!important}body{position:static!important;top:auto!important;left:auto!important;right:auto!important;width:auto!important;overflow:visible!important;padding-right:0!important;background:#fff!important}.srk-overlay:not(#order-invoice-overlay),body>*:not(#order-invoice-overlay){display:none!important}#order-invoice-overlay{display:block!important;position:static!important;inset:auto!important;opacity:1!important;background:#fff!important;overflow:visible!important}#order-invoice-overlay>header,.invoice-toolbar,.invoice-history-note{display:none!important}#order-invoice-overlay-scroll{display:block!important;overflow:visible!important;background:#fff!important}.invoice-stage{max-width:none!important;margin:0!important;padding:0!important}.purchase-invoice{width:auto!important;max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important}.invoice-brand,.invoice-facts,.invoice-payment,.invoice-parties,.invoice-lower,.invoice-signoff{break-inside:avoid}.invoice-table thead{display:table-header-group}.invoice-table tr{break-inside:avoid;page-break-inside:avoid}.invoice-table tfoot{display:table-footer-group}.invoice-footer{break-inside:avoid}.invoice-action{display:none!important}}'
        ].join(''));
    }

    function formatMoney(value, currency) {
        const number = Number(value || 0);
        try {
            return new Intl.NumberFormat('en-IN', {
                style: 'currency', currency: currency || 'INR',
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(number);
        } catch (error) {
            return '₹' + number.toFixed(2);
        }
    }

    function formatDate(value, includeTime) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Not recorded';
        const options = { day: '2-digit', month: 'short', year: 'numeric' };
        if (includeTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
        return date.toLocaleString('en-IN', options);
    }

    function addressHTML(address) {
        if (!address) return 'Not captured';
        return [address.address_line, address.city, address.state, address.postal_code, address.country]
            .filter(Boolean).map(escapeHtml).join(', ');
    }

    function paymentBadge(status) {
        const lower = String(status || '').toLowerCase();
        const tone = lower === 'paid' ? 'paid' :
            (lower.includes('refund') ? 'refunded' : (lower === 'failed' ? 'failed' : 'pending'));
        return '<span class="invoice-badge invoice-badge-' + tone + '">' + escapeHtml(status || 'Not recorded') + '</span>';
    }

    function factsHTML(invoice) {
        const facts = [
            ['Invoice number', invoice.number],
            ['Invoice date', formatDate(invoice.issued_at, false)],
            ['Order reference', invoice.order_reference],
            ['Place of supply', invoice.place_of_supply || 'Not captured']
        ];
        return facts.map(([label, value]) => '<div class="invoice-fact"><span class="invoice-label">' + escapeHtml(label) + '</span><span class="invoice-value">' + escapeHtml(value) + '</span></div>').join('');
    }

    function lineRows(data) {
        const currency = data.invoice.currency;
        return data.items.map(item => [
            '<tr>',
            '<td>' + item.position + '</td>',
            '<td><span class="invoice-description">' + escapeHtml(item.description) + '</span>' +
                (item.product_id === null || item.product_id === undefined ? '' : '<span class="invoice-item-id">Item ID ' + escapeHtml(String(item.product_id)) + '</span>') + '</td>',
            '<td>' + escapeHtml(String(item.quantity)) + '</td>',
            '<td>' + escapeHtml(formatMoney(item.unit_price, currency)) + '</td>',
            '<td>' + escapeHtml(formatMoney(item.taxable_value, currency)) + '</td>',
            '<td>' + escapeHtml(String(item.gst_rate_percent)) + '%</td>',
            '<td>' + escapeHtml(formatMoney(item.cgst_amount + item.sgst_amount + item.igst_amount, currency)) + '</td>',
            '<td>' + escapeHtml(formatMoney(item.line_total, currency)) + '</td>',
            '</tr>'
        ].join('')).join('');
    }

    function totalsHTML(data) {
        const t = data.totals;
        const currency = data.invoice.currency;
        const rows = [
            ['Items subtotal', t.subtotal],
            ['Transportation / delivery', t.shipping],
            ['Taxable value', t.taxable_value]
        ];
        // The invoice already names the applicable GST rate on every line.
        // Present the tax once in the summary instead of repeating the legal
        // CGST/SGST or IGST allocation as extra customer-facing rows.
        rows.push(['GST', t.gst]);
        return rows.map(row => '<tr><td>' + escapeHtml(row[0]) + '</td><td>' + escapeHtml(formatMoney(row[1], currency)) + '</td></tr>').join('') +
            '<tr class="invoice-grand"><td>Grand total</td><td>' + escapeHtml(formatMoney(t.grand_total, currency)) + '</td></tr>';
    }

    function invoiceHTML(data) {
        const seller = data.seller;
        const buyer = data.buyer;
        const payment = data.payment;
        const paymentMeta = [
            payment.method ? 'Method: ' + payment.method : null,
            payment.transaction_reference ? 'Reference: ' + payment.transaction_reference : null,
            payment.verified_at ? 'Verified: ' + formatDate(payment.verified_at, true) : null
        ].filter(Boolean).join(' · ') || 'Payment confirmation has not been recorded.';

        return [
            '<div class="invoice-stage">',
            '<div class="invoice-toolbar">',
            '<p class="invoice-toolbar-note">Payment details are read live. Product, price, tax and address values are frozen from checkout.</p>',
            '<div class="invoice-actions">',
            '<button type="button" id="invoice-refresh" class="invoice-action">' + REFRESH_ICON + '<span>Refresh status</span></button>',
            '<button type="button" id="invoice-print" class="invoice-action invoice-action-primary">' + PRINT_ICON + '<span>Print / Save PDF</span></button>',
            '</div></div>',
            data.snapshot && !data.snapshot.complete ? '<div class="invoice-history-note">' + escapeHtml(data.snapshot.note || 'This is a historical order with an incomplete invoice snapshot.') + '</div>' : '',
            '<article class="purchase-invoice" aria-label="Purchase invoice ' + escapeHtml(data.invoice.number) + '">',
            '<div class="invoice-brand">',
            '<div><img class="invoice-logo" src="/assets/icons/SRK-Team-Star-Logos/primary-bgless.png" alt="SRK Team Star"><p class="invoice-brandline">Framing machinery · hardware · production solutions</p></div>',
            '<div class="invoice-title"><h1>Purchase Invoice</h1><p>Original for recipient</p></div>',
            '</div>',
            '<div class="invoice-facts">' + factsHTML(data.invoice) + '</div>',
            '<div class="invoice-payment"><div class="invoice-payment-copy"><p class="invoice-payment-title">Payment status</p><p class="invoice-payment-meta">' + escapeHtml(paymentMeta) + '</p></div>' + paymentBadge(payment.status) + '</div>',
            '<div class="invoice-parties">',
            '<section class="invoice-party"><h2>Seller</h2><strong>' + escapeHtml(seller.trade_name) + '</strong><p>' + escapeHtml(seller.legal_name) + '<br>' + escapeHtml(seller.address) + '<br>GSTIN: ' + escapeHtml(seller.gstin) + '<br>' + escapeHtml(seller.email) + ' · ' + escapeHtml(seller.phone) + '</p></section>',
            '<section class="invoice-party"><h2>Bill to / Ship to</h2><strong>' + escapeHtml(buyer.company || buyer.name) + '</strong><p>' + (buyer.company ? escapeHtml(buyer.name) + '<br>' : '') + addressHTML(data.shipping_address) + (buyer.email ? '<br>' + escapeHtml(buyer.email) : '') + (buyer.phone ? ' · ' + escapeHtml(buyer.phone) : '') + '</p></section>',
            '</div>',
            '<div class="invoice-table-wrap"><table class="invoice-table"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Taxable</th><th>GST</th><th>Tax</th><th>Total</th></tr></thead><tbody>' + lineRows(data) + '</tbody></table></div>',
            '<div class="invoice-lower">',
            '<div><div class="invoice-words"><span class="invoice-label">Amount in words</span><p>' + escapeHtml(data.amount_in_words) + '</p></div><p class="invoice-note">Transportation is included in the taxable value where charged. This document reflects the order and payment records held by SRK Team Star at the time shown.</p></div>',
            '<table class="invoice-totals"><tbody>' + totalsHTML(data) + '</tbody></table>',
            '</div>',
            '<div class="invoice-signoff"><p>For questions about this invoice, quote both the invoice number and order reference.<br>' + escapeHtml(seller.email) + ' · ' + escapeHtml(seller.phone) + '</p><div class="invoice-authority">For ' + escapeHtml(seller.trade_name) + '<br>Authorised signatory</div></div>',
            '<div class="invoice-footer">' + escapeHtml(seller.trade_name) + ' · GSTIN ' + escapeHtml(seller.gstin) + ' · ' + escapeHtml(seller.website) + '</div>',
            '</article></div>'
        ].filter(Boolean).join('');
    }

    function loadingHTML() {
        return '<div class="invoice-stage"><div class="bg-white border border-[#12170f]/10 rounded-sm py-24 px-6 text-center"><p class="text-sm font-bold text-[#12170f]">Preparing your invoice…</p><p class="text-xs text-[#1f271b]/55 mt-2">Reading the frozen order and current payment status.</p></div></div>';
    }

    function errorHTML(message) {
        return '<div class="invoice-stage"><div class="bg-white border border-red-200 rounded-sm py-16 px-6 text-center"><p class="text-base font-bold text-[#12170f]">Invoice unavailable</p><p class="text-sm text-[#1f271b]/60 mt-2">' + escapeHtml(message || 'Could not load that invoice.') + '</p><button type="button" id="invoice-refresh" class="invoice-action mt-6">Try again</button></div></div>';
    }

    async function load(orderId, orderToken) {
        if (!handle) return;
        handle.body.innerHTML = loadingHTML();

        try {
            const response = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/invoice', {
                credentials: 'include',
                headers: Object.assign(
                    { 'Accept': 'application/json' },
                    orderToken ? { 'X-Order-Access-Token': orderToken } : {}
                )
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error((payload && payload.error) || 'Could not load that invoice.');
            if (!handle || String(activeOrderId) !== String(orderId)) return;
            handle.body.innerHTML = invoiceHTML(payload);
        } catch (error) {
            console.error('Invoice request failed.', error);
            if (handle && String(activeOrderId) === String(orderId)) handle.body.innerHTML = errorHTML(error.message);
        }
    }

    function open(orderId, orderToken) {
        if (orderId === null || orderId === undefined || orderId === '') return;
        styles();
        activeOrderId = orderId;
        activeOrderToken = orderToken || null;

        if (!handle) {
            handle = chrome.openOverlay({
                id: 'order-invoice-overlay',
                titleId: 'order-invoice-title',
                closeId: 'order-invoice-close',
                header: chrome.headerHTML({
                    titleId: 'order-invoice-title', title: 'Purchase Invoice',
                    subtitle: 'A clean, printable record of your order and its current payment status.',
                    closeId: 'order-invoice-close', closeLabel: 'Close invoice'
                }),
                onClose: () => { handle = null; activeOrderId = null; activeOrderToken = null; }
            });

            handle.body.addEventListener('click', event => {
                const refresh = event.target.closest && event.target.closest('#invoice-refresh');
                if (refresh) return load(activeOrderId, activeOrderToken);
                const print = event.target.closest && event.target.closest('#invoice-print');
                if (print) window.print();
            });
        }

        load(orderId, activeOrderToken);
    }

    window.orderInvoice = { open, refresh: () => activeOrderId && load(activeOrderId, activeOrderToken) };
})();
