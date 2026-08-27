/**
 * my-orders-module.js
 *
 * The customer's own order history, rendered into whatever container is handed
 * to it — today the "My Orders" section of the account overlay.
 *
 * DATA SOURCE
 * -----------
 * GET /api/orders/mine, which reads the real `orders`, `order_items`,
 * `order_shipping_address` and `payments` tables, scoped to whoever the
 * session cookie says is signed in. `window.myOrders.load()` was the seam
 * while this was a sample array; it is now the fetch, and the renderer above
 * it never learned which it was — which is what the seam was for.
 *
 * THE SHAPE IS NOT orders.js's, ON PURPOSE
 * ----------------------------------------
 * An earlier mock stored `date: "05 Aug 2026"` and
 * `total: "₹ 4,45,500"` — presentation, not data. Neither can be sorted,
 * re-localised, or recomputed when a quantity changes, and its "4 items" is a
 * count with no line items behind it, so the drawer has to invent a product to
 * show. Copying that here would bake the same dead end into new code on the day
 * it was written.
 *
 * So an order carries an ISO `placed_at`, real `items[]` with unit prices and
 * quantities, and no money it has not worked out from them. That is also the
 * shape the eventual `orders` / `order_items` tables want, which is what makes
 * this replaceable rather than rewritable.
 *
 * PRICES ARE TEXT UPSTREAM, SO TOTALS ARE CAREFUL
 * -----------------------------------------------
 * `products.price` is a `text` column and "On request" is a legal value, so a
 * line may have no number. A real order would have been priced before it was
 * placed, but the sample has to survive the same case the cart does, and it
 * uses the same `parseProductPrice` to do it.
 *
 * BADGES MATCH THE DASHBOARD
 * --------------------------
 * The status colours are the back office's, so the "Shipped" a customer sees and
 * the "Shipped" written against the order are the same object in the same palette.
 *
 * LOAD ORDER
 * ----------
 * After customer-session-module.js and price-format-module.js. Before
 * profile-icon-loader.js, which mounts it.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.myOrders) return;

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('my-orders-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml, EYEBROW_CLASSES, CHEVRON_ICON, PACKAGE_ICON } = chrome;

    // ------------------------------------------------------------------
    // DATA SOURCE
    // ------------------------------------------------------------------
    // GET /api/orders/mine (backend/server.js) — session-scoped, so it needs
    // no argument and cannot be asked for somebody else's orders: the route
    // reads the customer id off the session cookie and filters on it in the
    // query, rather than fetching every order and narrowing afterwards.
    //
    // The shape below is the one the sample data here was written in, which
    // was the point of writing it that way: an ISO placed_at, real items[]
    // with unit prices and quantities, and no money not derived from them.
    // Nothing in the renderer changed when the array became a fetch.
    async function load() {
        // Asked before the request so a signed-out visitor costs no round
        // trip — the account view only mounts this panel when someone is
        // signed in, but renderPanel is public and may be called elsewhere.
        const customer = window.customerSession && window.customerSession.current();
        if (!customer) return [];

        const response = await fetch('/api/orders/mine', {
            // The session cookie is the whole identity of this request.
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Orders request failed with ' + response.status);
        }

        const orders = await response.json();
        if (!Array.isArray(orders)) return [];

        // The route already orders by created_at descending; sorted again
        // here so the panel does not depend on that promise being kept.
        return orders.slice().sort((a, b) => new Date(b.placed_at) - new Date(a.placed_at));
    }

    // ------------------------------------------------------------------
    // FORMATTING
    // ------------------------------------------------------------------
    // The format every surface uses, so a reference quoted over the phone
    // and a date read back match what staff are looking at.
    function formatDate(iso) {
        if (!iso) return 'Unknown date';

        const date = new Date(iso);
        if (isNaN(date.getTime())) return 'Unknown date';

        return date.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function orderTotals(order) {
        const parse = window.parseProductPrice || (() => null);

        let amount = 0;
        let unpriced = 0;

        order.items.forEach(item => {
            const unit = parse(item.unit_price);
            if (unit === null) {
                unpriced += 1;
                return;
            }
            amount += unit * item.quantity;
        });

        return { amount, unpriced, priced: order.items.length - unpriced };
    }

    function unitCount(order) {
        return order.items.reduce((total, item) => total + item.quantity, 0);
    }

    // Lifted from the back office so the storefront and the back office agree.
    // Orders carry two states quotes do not, and Cancelled is the only one that
    // reads as a stop rather than as progress.
    function badgeClasses(status) {
        if (status === 'Delivered') return 'text-green-600 border-green-500 bg-green-50/30';
        if (status === 'Shipped') return 'text-blue-600 border-blue-500 bg-blue-50/30';
        if (status === 'Processing') return 'text-yellow-600 border-yellow-500 bg-yellow-50/30';

        // 'Pending Payment' USED TO LAND ON THE LINE BELOW, WHICH IS THE
        // CANCELLED COLOUR.
        //
        // Three of the five statuses were named and everything else fell
        // through to red — which was fine while 'Cancelled' was the only
        // unnamed one. Migration 014 added an order status this file never
        // learned, so an order being held open for the customer to pay for was
        // painted in the same red as one that had been called off. Worse, the
        // the historical fallback was `|| ORDER_STATUS_CLASSES['Processing']`
        // — yellow — so the two surfaces showed the identical order in the two
        // colours that mean the opposite things, and this file's own header
        // claims they are the same object.
        //
        // Amber, and deliberately neither of those two: the order is not
        // progressing and it is not over. It is waiting for the customer.
        if (status === 'Pending Payment') return 'text-amber-700 border-amber-500 bg-amber-50/60';

        return 'text-red-600 border-red-500 bg-red-50/30';
    }

    // Is this order waiting for the customer to pay for it?
    //
    // Read off `can_cancel`, which the server computes, rather than re-derived
    // from the status string here. The rule that decides it lives in one place
    // and POST /api/orders/:id/cancel enforces the same one — a second copy in
    // the browser is a second thing to keep in step, and it would be the copy
    // that decides whether to draw a button the server may refuse.
    const isAwaitingPayment = (order) => Boolean(order && order.can_cancel);

    // The strip under an unpaid order's header. Outside the collapsible body
    // on purpose: this is the one thing on the card that needs doing, and
    // burying it behind a disclosure toggle is how an order stays unpaid.
    //
    // PAY NOW IS A LINK, NOT A BUTTON, AND IT LEAVES THIS PAGE.
    //
    // store.html loads neither payment-module.js nor Razorpay's CSP grant —
    // that grant is keyed to `data-razorpay-checkout` on the checkout
    // document alone, so that a visitor who never buys anything is never
    // served a third-party script source. Opening the modal from this panel
    // would mean widening both to the page every visitor lands on, to serve
    // the rare account view that needs it. The checkout page already has the
    // script, the grant and the awaiting screen, so this hands the order over
    // to it. An <a> for the same reason the cart's checkout button is one: a
    // navigation should middle-click into a new tab like any other link.
    function unpaidActionsHTML(order) {
        return [
            '<div class="px-5 py-3.5 bg-amber-50/70 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-3">',
            '    <p class="text-[11px] font-semibold text-amber-900/80 leading-relaxed min-w-[12rem] flex-1">',
            '        Waiting for payment. Nothing has been charged, and we are holding it for you.',
            '    </p>',
            '    <div class="flex items-center gap-2 shrink-0">',
            // Only when the SERVER offered a handshake. An order awaiting
            // payment on a deployment where the gateway has since been
            // switched off cannot be settled here, and a Pay-now that leads
            // to "this cannot be paid online" is worse than no button.
            // Cancel still applies, so the strip is not empty.
            order.payment
                ? '        <a href="/store/checkout.html?resume=' + encodeURIComponent(order.id) + '"' +
                  ' class="px-4 py-2 rounded-sm bg-[#d4af37] text-white text-[11px] font-bold uppercase tracking-wider hover:bg-[#12170f] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12170f]">Pay now</a>'
                : '',
            '        <button type="button" data-cancel-order="' + escapeHtml(String(order.id)) + '"',
            '           class="px-4 py-2 rounded-sm border border-[#12170f]/20 bg-white text-[#1f271b] text-[11px] font-bold uppercase tracking-wider hover:bg-[#12170f] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12170f]">Cancel</button>',
            '    </div>',
            '</div>'
        ].filter(entry => entry !== '').join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP
    // ------------------------------------------------------------------
    function itemsHTML(order) {
        const format = window.formatProductPrice || (value => value);
        const amount = window.formatAmount || (() => '');
        const parse = window.parseProductPrice || (() => null);

        // Numbered #1, #2 — the same numbering the quote overlay shows the
        // customer and the back office echoes back in the back office, so a
        // conversation about "item 2" means one thing everywhere.
        const rows = order.items.map((item, index) => {
            const unit = parse(item.unit_price);
            const lineTotal = unit === null ? '' : amount(unit * item.quantity);

            return [
                '<tr class="border-t border-[#12170f]/5">',
                '    <td class="py-3 px-4 text-[10px] font-bold text-[#1f271b]/40 align-top w-[8%]">#' + (index + 1) + '</td>',
                '    <td class="py-3 px-4 align-top">',
                '        <p class="text-[#12170f] font-bold text-sm">' + escapeHtml(item.product_name) + '</p>',
                '        <p class="text-[10px] text-[#1f271b]/60 uppercase tracking-wider mt-0.5">' + escapeHtml(item.category_name || 'Uncategorised') + '</p>',
                '        <p class="text-[11px] text-[#1f271b]/60 mt-1">' + escapeHtml(format(item.unit_price) || 'Price on request') + ' × ' + item.quantity + '</p>',
                '    </td>',
                '    <td class="py-3 px-4 align-top text-right text-xs font-bold text-[#1f271b]/70 whitespace-nowrap">' +
                     (lineTotal ? escapeHtml(lineTotal) : '<span class="text-[#1f271b]/40 font-medium italic">On request</span>') +
                '</td>',
                '</tr>'
            ].join('\n');
        }).join('\n');

        const totals = orderTotals(order);

        return [
            '<div class="bg-white rounded-sm border border-[#12170f]/10 overflow-hidden">',
            '    <table class="w-full border-collapse"><tbody>' + rows + '</tbody></table>',
            '</div>',
            '<div class="flex items-baseline justify-between gap-4 mt-4 pt-4 border-t border-[#12170f]/10">',
            '    <span class="' + EYEBROW_CLASSES + ' text-[#1f271b]/50">Order Total</span>',
            '    <span class="text-lg font-bold tracking-tight text-[#12170f]">' +
                 (totals.priced ? escapeHtml((window.formatAmount || (() => ''))(totals.amount)) : '<span class="text-sm italic font-semibold text-[#1f271b]/50">On request</span>') +
            '</span>',
            '</div>',
            totals.unpriced
                ? '<p class="text-[11px] text-[#1f271b]/50 mt-1.5">' + totals.unpriced +
                  (totals.unpriced === 1 ? ' item was' : ' items were') + ' priced on request and quoted separately.</p>'
                : '',
            '<div class="grid grid-cols-[110px_1fr] gap-y-3 text-sm mt-5">',
            '    <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Payment</div>',
            '    <div class="text-[#12170f] font-bold text-xs">' + escapeHtml(order.payment_status || 'Pending') + '</div>',
            '    <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Tracking</div>',
            '    <div class="text-[#12170f] font-bold text-xs">' +
                 (order.tracking ? escapeHtml(order.tracking) : '<span class="text-[#1f271b]/40 font-medium italic">Not dispatched yet</span>') +
            '</div>',
            '    <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">Delivering to</div>',
            '    <div class="text-[#1f271b]/80 font-semibold text-xs leading-relaxed">' + escapeHtml(order.shipping_address || 'No address on file') + '</div>',
            '</div>'
        ].filter(entry => entry !== '').join('\n');
    }

    // Collapsed by default. A history is scanned far more often than it is
    // read, and three orders' worth of line items would bury the one being
    // looked for.
    function orderHTML(order) {
        const units = unitCount(order);

        return [
            '<div class="border border-[#12170f]/10 rounded-sm bg-white overflow-hidden mb-4" data-order="' + escapeHtml(order.reference) + '">',
            '    <button type="button" class="orders-toggle w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]"',
            '            aria-expanded="false" aria-controls="order-body-' + escapeHtml(order.reference) + '">',
            '        <div class="min-w-0 flex-1">',
            '            <p class="text-sm font-bold text-[#12170f] truncate">' + escapeHtml(order.reference) + '</p>',
            '            <p class="text-[11px] text-[#1f271b]/60 mt-0.5">' + escapeHtml(formatDate(order.placed_at)) + ' · ' + units + (units === 1 ? ' item' : ' items') + '</p>',
            '        </div>',
            '        <span class="shrink-0 px-2.5 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider border ' + badgeClasses(order.status) + '">' + escapeHtml(order.status) + '</span>',
            '        ' + CHEVRON_ICON,
            '    </button>',
            isAwaitingPayment(order) ? unpaidActionsHTML(order) : '',
            '    <div id="order-body-' + escapeHtml(order.reference) + '" class="hidden px-5 pb-5 pt-1 bg-[#f8fafc] border-t border-[#12170f]/5">',
            '        ' + itemsHTML(order),
            '    </div>',
            '</div>'
        ].join('\n');
    }

    function emptyHTML() {
        return [
            '<div class="text-center py-12 px-6 border border-dashed border-[#12170f]/15 rounded-sm bg-white">',
            '    <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#12170f]/30">',
            '        ' + PACKAGE_ICON,
            '    </div>',
            '    <p class="text-sm font-bold text-[#12170f] mb-1.5">No orders yet</p>',
            '    <p class="text-sm text-[#1f271b]/60">Anything you order will show up here, with its items and delivery status.</p>',
            '</div>'
        ].join('\n');
    }

    function loadingHTML() {
        return '<p class="text-sm text-[#1f271b]/50 font-semibold py-8 text-center">Loading your orders…</p>';
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    async function renderPanel(container) {
        if (!container) return;

        container.innerHTML = loadingHTML();

        let orders;
        try {
            orders = await load();
        } catch (error) {
            console.error('My Orders: could not load orders.', error);
            container.innerHTML = '<p class="text-sm text-red-600 font-semibold py-8 text-center">Could not load your orders. Try again in a moment.</p>';
            return;
        }

        // The overlay may have been closed, or switched away, mid-load.
        if (!container.isConnected) return;

        container.innerHTML = orders.length
            ? orders.map(orderHTML).join('\n')
            : emptyHTML();

        wire(container);
    }

    // One listener for the panel rather than one per row: the panel is
    // re-rendered whole whenever the account view is reopened.
    //
    // BOUND ONCE PER CONTAINER, NOT ONCE PER RENDER. renderPanel() replaces
    // the panel's innerHTML and then calls this, so without the mark below a
    // second render would stack a second identical listener on the same
    // element — and every toggle click would then fire twice, opening the row
    // and immediately closing it again. Nothing had noticed because the panel
    // was only ever rendered once per mount; cancelling an order re-renders it
    // in place, which is what made this reachable.
    function wire(container) {
        if (container.dataset.ordersWired === 'true') return;
        container.dataset.ordersWired = 'true';

        container.addEventListener('click', (event) => {
            const cancel = event.target.closest('[data-cancel-order]');
            if (cancel && container.contains(cancel)) return cancelOrder(cancel, container);

            const toggle = event.target.closest('.orders-toggle');
            if (!toggle || !container.contains(toggle)) return;

            const body = document.getElementById(toggle.getAttribute('aria-controls'));
            if (!body) return;

            const open = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
            body.classList.toggle('hidden', open);
        });
    }

    // Closes out an unpaid order from the history.
    //
    // The SERVER decides whether this is allowed — it re-checks the status,
    // the payment row, and Razorpay itself before writing anything, because a
    // customer can be standing in the payment modal in another tab while
    // pressing this. So there is no optimism here: the panel is re-rendered
    // from a fresh fetch afterwards either way, and a refusal is shown as the
    // sentence the server sent rather than flattened to "failed".
    //
    // No confirm() — this storefront uses none anywhere — and none is owed:
    // nothing has been charged, and ordering the same items again is a few
    // clicks. The button relabels itself instead, the same idiom the checkout
    // page's own cancel uses.
    async function cancelOrder(button, container) {
        if (button.disabled) return;

        button.disabled = true;
        button.textContent = 'Cancelling…';

        const id = button.getAttribute('data-cancel-order');
        let response, payload;

        try {
            response = await fetch('/api/orders/' + encodeURIComponent(id) + '/cancel', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            payload = await response.json().catch(() => null);
        } catch (error) {
            console.error('My Orders: cancel request failed.', error);
            button.disabled = false;
            button.textContent = 'Cancel';
            return showRowMessage(button, 'Could not reach the server. Try again in a moment.');
        }

        if (!response.ok) {
            // A 409 usually means the order moved on under us — most often
            // because it was actually paid for. Re-rendering shows the truth,
            // and the sentence explains why the button did nothing.
            const message = (payload && payload.error) || 'Could not cancel that order.';
            if (response.status === 409) {
                await renderPanel(container);
                return;
            }
            button.disabled = false;
            button.textContent = 'Cancel';
            return showRowMessage(button, message);
        }

        await renderPanel(container);
    }

    // A sentence in the strip the button sits in. Not a banner at the top of
    // the panel: with several orders listed, a message about one of them
    // belongs beside it.
    function showRowMessage(button, message) {
        const strip = button.closest('div.px-5');
        if (!strip) return;

        const existing = strip.querySelector('.orders-row-error');
        if (existing) existing.remove();

        const note = document.createElement('p');
        note.className = 'orders-row-error basis-full text-[11px] font-bold text-red-600';
        note.textContent = message;
        strip.appendChild(note);
    }

    window.myOrders = {
        load,
        renderPanel,
        formatDate,
        orderTotals
    };
})();
