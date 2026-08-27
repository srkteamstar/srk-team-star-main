/**
 * checkout-module.js — the checkout page (store/checkout.html)
 *
 * Left column: who you are and where it goes. Right column: what it costs.
 * The cart drawer's "Proceed to Checkout" used to be a disabled button with a
 * sentence explaining that online ordering did not exist; it comes here now.
 *
 * THE BROWSER DOES NOT PRICE ANYTHING
 * -----------------------------------
 * The cart lives in the browser — sessionStorage for a guest, and for a
 * signed-in customer a `cart_items` table the server fills from what that
 * browser told it. Either way the customer can edit it — names, prices,
 * anything — and the snapshot prices stored server-side are the customer's
 * claims rather than the server's findings, so they are never read back as
 * money. This page therefore sends nothing but product ids and quantities,
 * and every figure it displays comes back from POST /api/checkout/summary,
 * which prices the basket against the `products` table. POST /api/checkout
 * then re-prices it a second time from the same function before writing a
 * single row.
 *
 * That double pricing is deliberate and is not redundant: the summary is a
 * display call and minutes may pass before the order is placed. If a price
 * changed in between, the order is written at the real one — and because both
 * routes run the identical priceCheckout(), what was shown and what is charged
 * can only differ if the catalogue itself moved.
 *
 * The one thing taken from the cart snapshot is the thumbnail, which is
 * decoration. Nothing that becomes money is read from the browser.
 *
 * ITEMS PRICED "ON REQUEST" CANNOT BE CHECKED OUT
 * -----------------------------------------------
 * `products.price` is a text column and most of this catalogue has no number
 * in it — 43 of 48 rows when this was written. There is no total to compute
 * for those, so they are shown struck through with the reason, and the route
 * refuses the order rather than quietly dropping them from a total the
 * customer is looking at. The way to buy them is the quote overlay, which is
 * one click from here.
 *
 * NOTHING ON THIS PAGE MOVES MONEY
 * --------------------------------
 * There is no gateway and no key. Placing an order writes the order and a
 * `Pending` payment row for the team to reconcile — an ordinary B2B flow.
 *
 * That is a fact about the plumbing, and the copy no longer recites it. The
 * page used to carry "No payment is taken now" under the button, "nothing is
 * charged now" under the method picker, and "Nothing has been charged" on the
 * failure screen — three sentences about a transaction the customer had not
 * asked about, in a flow where every one of them reads as a caveat. What
 * replaced them says what happens next instead: the page shows an order
 * reference and somebody gets in touch. The Payment Method step still asks how they
 * would prefer to settle, because that is a real question with a real answer
 * the sales team uses.
 *
 * What must NOT come back is a claim that money moved. `payments.status` is
 * written `Pending` whatever is picked here, and a browser callback is not
 * proof of payment — so no screen on this page may say "paid", and nothing a
 * browser can reach may set that status.
 *
 * LOAD ORDER
 * ----------
 * After price-format-module.js, store-overlay-shared-module.js,
 * product-section-shared-module.js, cart-module.js and
 * customer-session-module.js. See the script block in store/checkout.html.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    const chrome = window.storeOverlay;
    const cart = window.storeCart;
    const account = window.customerSession;

    // A missing dependency used to return here with nothing but a console
    // line, which left the page's static "Loading your order..." on screen
    // forever — the worst failure shape available, because it looks like a
    // slow network rather than a broken page. Say so on screen instead.
    if (!chrome || !cart || !account) {
        const missing = [
            !chrome && 'store-overlay-shared-module.js',
            !cart && 'cart-module.js',
            !account && 'customer-session-module.js'
        ].filter(Boolean).join(', ');

        console.error('checkout-module.js is missing: ' + missing + '. Check the script order in checkout.html.');

        const el = document.getElementById('checkout-root');
        if (el) {
            el.innerHTML = '<div class="py-24 text-center">' +
                '<h2 class="text-xl font-bold tracking-tight mb-3">Checkout could not load</h2>' +
                '<p class="text-sm text-[#1f271b]/60 mb-6">Something did not load on this page. Your cart is safe.</p>' +
                '<a href="/store/store.html" class="text-sm font-bold text-[#d4af37] hover:underline">Back to store</a></div>';
        }
        return;
    }

    const {
        escapeHtml, icon, ensureStyles,
        PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, EYEBROW_CLASSES,
        sectionHeading, textFieldHTML, textAreaHTML, bannerHTML,
        fieldError, clearErrorsIn, enhance, PACKAGE_ICON
    } = chrome;

    const formatAmount = window.formatAmount || ((value) => String(value));

    const root = document.getElementById('checkout-root');
    if (!root) return;

    // Contact/Delivery use the site-wide FIELD_CLASSES token from
    // store-overlay-shared-module.js — deliberately not edited here, since
    // that would resize every field on the storefront (the quote form,
    // sign-in, account edit...) for a request scoped to this one page. A
    // higher-specificity, #checkout-form-scoped rule beats the Tailwind
    // utility classes FIELD_CLASSES applies without touching the token.
    ensureStyles('checkout-field-size-styles', [
        '#checkout-form input[type], #checkout-form textarea {',
        '    padding-top: .5rem; padding-bottom: .5rem;',
        '    padding-left: .75rem; padding-right: .75rem;',
        '    font-size: .875rem;',
        '}',
        '#checkout-form textarea { min-height: 72px; }'
    ].join(''));

    // THE PRINT BUTTON'S GLYPH HAS TO BE PAINTED HERE, NOT INHERITED.
    //
    // Two things stack up on this page and either one alone would hide the
    // icon on hover:
    //
    //   * checkout.html opens its inline <style> with `* { color: #1f271b }`,
    //     which matches the <svg> directly — and a direct match beats an
    //     inherited value, so the button's `hover:text-white` never reaches an
    //     icon drawn with stroke="currentColor". That is the same trap
    //     .cart-icon-btn and .category-btn .check-icon already exist to answer.
    //   * SECONDARY_BUTTON_CLASSES carries `.srk-secondary-btn`, and the rules
    //     behind it live in store-overlay-shared-module.js's BASE_CSS — which
    //     is injected by openOverlay/openDrawer and by nothing else. This page
    //     is a plain page and opens neither, so on /store/checkout.html those
    //     rules are simply absent.
    //
    // Result without this: on hover the button fills near-black and the icon
    // stays near-black with it. Its own sheet rather than appended to the one
    // above, so `checkout-field-size-styles` keeps meaning what its name says.
    //
    // The same trap catches the LABEL, not only the glyph, and that half was
    // missed. This is the one secondary button on the page whose text sits in
    // its own <span> — it has to, so the icon and the words can be flex
    // children — and `*` matches that <span> directly, so the button's
    // `hover:text-white` never reaches it either. Every other secondary button
    // here is bare text, which is why "Back to store" turns white on hover and
    // this one filled near-black and kept a near-black label sitting on top of
    // it. The resting colour is wrong for the same reason — `*` paints the span
    // #1f271b where the token asks for #12170f — so both states are pinned.
    ensureStyles('checkout-print-button-styles', [
        '#checkout-print svg { stroke: #12170f; transition: stroke 200ms ease; }',
        // font-weight/size ride along because the same `*` rule sets both on
        // every element: without these the label would render at the universal
        // 500 while every other button on the row is 700.
        '#checkout-print span { color: #12170f; transition: color 200ms ease; font-weight: inherit; font-size: inherit; }',
        '#checkout-print:hover svg { stroke: #ffffff; }',
        '#checkout-print:hover span { color: #ffffff; }',
        // A disabled button answers no hover, so neither the glyph nor the
        // label may flip — the button spends 1.8s disabled every time it is
        // pressed, and it is relabelled for exactly that window.
        '#checkout-print:disabled:hover svg { stroke: #12170f; }',
        '#checkout-print:disabled:hover span { color: #12170f; }'
    ].join(''));

    // THE WHOLE-PAGE ACTION ROW IS SIZED HERE, FOR THE SAME REASON THE FIELDS
    // ABOVE ARE.
    //
    // PRIMARY_BUTTON_CLASSES and SECONDARY_BUTTON_CLASSES are deliberately
    // different sizes — `text-base font-semibold px-8 py-3.5` against `text-sm
    // font-bold px-6 py-3`. That is right where they sit inline next to each
    // other in a drawer or an overlay footer, and wrong on a confirmation
    // screen, where three of them are the only thing on an otherwise empty
    // page and every difference in height, width and type size reads as an
    // accident rather than as hierarchy. Those tokens are shared with the
    // quote form, sign-in, sign-up, the cart drawer and the account overlay,
    // so they are not the place to fix this: same reasoning as
    // #checkout-field-size-styles above, and an ID-scoped selector beats a
    // plain utility class on specificity without editing the token or having
    // to fight it on !important.
    //
    // The arrangement is one line of CSS rather than a class each caller
    // passes: a last child in an odd position spans both columns. One action
    // is a single full-width button, two sit side by side, three make a 2 + 1
    // block whose bottom row is exactly as wide as the pair above it. So the
    // row is deliberate at every count noticeHTML is called with, and stays
    // that way if a state ever gains or loses a button.
    //
    // The 32rem ceiling and noticeHTML's `max-w-xl` wrapper are one decision:
    // at two columns the cell has to hold "Print / Download PDF" — the longest
    // label on the page, and one carrying an icon — without wrapping it onto a
    // second line inside a fixed-height button. The old `max-w-md` wrapper is
    // ~80px too narrow for that, so the prose keeps that measure on the <p>
    // itself and only the action row takes the extra room.
    ensureStyles('checkout-actions-styles', [
        '#checkout-actions { display: grid; gap: .75rem; width: 100%; max-width: 32rem; margin-left: auto; margin-right: auto; }',
        '@media (min-width: 640px) {',
        '    #checkout-actions { grid-template-columns: 1fr 1fr; }',
        '    #checkout-actions > *:last-child:nth-child(odd) { grid-column: 1 / -1; }',
        '}',
        '#checkout-actions > * {',
        '    width: 100%;',
        '    min-height: 52px;',
        '    padding-left: 1rem; padding-right: 1rem;',
        '    font-size: .9375rem;',
        '    font-weight: 700;',
        '    line-height: 1.2;',
        '}'
    ].join(''));

    // ------------------------------------------------------------------
    // PAYMENT METHOD
    // ------------------------------------------------------------------
    // TWO CHOICES, AND THEY ARE THE TWO THE CUSTOMER ACTUALLY MAKES.
    //
    // This picker used to offer four cards — Bank Transfer, UPI, Cheque, Cash
    // on Delivery — and then, with the gateway on, a fifth "Pay Now" above
    // them. That is five ways of answering a question with two answers. Three
    // of the four were the same answer ("we will settle this between us
    // later") in different clothes, and one of them, an offline "UPI" card,
    // sat inches from the gateway's real UPI and did something completely
    // different: one takes a payment, the other records a claim that one was
    // made. There was already a filter here dropping that card when the
    // gateway was up, which is the shape of a design apologising for itself.
    //
    // So: Pay Now, or Pay on Receipt. The instruments the customer cares about
    // — UPI, cards, EMI — did not go away; they moved behind Pay Now, where
    // they are real and the gateway REPORTS which one was used, instead of
    // being guessed from a card click. They are named on the Pay Now card
    // (SUB_INSTRUMENTS below) so the choice is legible before the modal opens.
    //
    // HOW EACH OFFLINE INSTRUMENT LOOKS. NOT WHICH ONES EXIST.
    //
    // The list itself arrives from the server on /api/checkout/summary as
    // `payment_methods`, read out of the same PAYMENT_METHODS constant that
    // validates the submitted value. It used to be typed out here as well,
    // under a comment asking whoever edited one to remember the other — and
    // that drift fails silently in the direction that costs money: a method
    // offered here but absent from the server's list is accepted by the page,
    // posted, and rewritten to PAYMENT_METHODS[0] as the order is written.
    // Nothing reports a problem; the customer picks one thing and the invoice
    // says another.
    //
    // What stays here is presentation, because that is genuinely this file's:
    // an SVG path in an API response would be a rendering decision leaking
    // into a contract. `label` is part of that — the server's key is the
    // INSTRUMENT ('Cash on Delivery', which is what lands in
    // payments.payment_method and prints on the invoice); the card says "Pay
    // on Receipt" because that is the choice being made. A key with no entry
    // below still renders — with the fallback glyph and its own name as the
    // label — so adding a method to the server is enough to make it appear,
    // and adding an icon here is a separate, optional improvement to it.
    const METHOD_PRESENTATION = {
        'Cash on Delivery': {
            label: 'Pay on Receipt',
            hint: 'Cash on Delivery',
            path: 'M3 7h13v9H3V7zm13 3h4l3 3v3h-7v-6zM6 20a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z'
        }
    };

    // A plain card outline, for a method the server offers that nothing above
    // has drawn yet.
    const FALLBACK_METHOD_PATH = 'M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z';

    // Used only until the summary lands, and as the fallback for a server too
    // old to publish the list. Kept identical to the contract's own order, so
    // the pre-flight default and the server's PAYMENT_METHODS[0] agree on what
    // 'first' means.
    const DEFAULT_METHOD_KEYS = ['Cash on Delivery'];

    const methodKeys = () => (
        priced && Array.isArray(priced.payment_methods) && priced.payment_methods.length
            ? priced.payment_methods
            : DEFAULT_METHOD_KEYS
    );

    function offlineMethods() {
        return methodKeys().map(key => {
            const look = METHOD_PRESENTATION[key] || {};
            return {
                mode: 'offline',
                key: key,
                label: look.label || key,
                hint: look.hint || '',
                path: look.path || FALLBACK_METHOD_PATH
            };
        });
    }

    // What Pay Now covers, named on the card.
    //
    // These are NOT keys and never travel to the server. Razorpay decides
    // which of them the customer ends up using, inside its own modal, and
    // reports it back at capture — `payments.payment_method` is then filled
    // from that observation. Listing them here is a promise about what the
    // modal will offer, which is why they are three words and not three
    // clickable cards: a card implies this page can commit to one, and it
    // cannot.
    const SUB_INSTRUMENTS = ['UPI', 'Cards', 'EMI'];

    // Not one of PAYMENT_METHODS, and deliberately not given a `key`. Those
    // are *instruments* and the server whitelists them into
    // payments.payment_method; this is a *mode*, and the instrument behind it
    // is not known until Razorpay reports which one the customer actually
    // used. Giving it a key here would invite somebody to send it as an
    // instrument, and the server would quietly fall back to PAYMENT_METHODS[0]
    // — an order paid by card, filed as Cash on Delivery.
    const ONLINE_METHOD = {
        mode: 'online',
        label: 'Pay Now',
        hint: SUB_INSTRUMENTS.join(' \u00b7 '),
        path: 'M3 10h18M7 15h2m4 0h4M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z'
    };

    // Small gold badge on a selected card, distinct from CHECK_ICON
    // (store-overlay-shared-module.js), which is sized for a full-overlay
    // confirmation screen rather than a 20px corner badge — the same reason
    // request-quote-module.js keeps its own CARD_CHECK_ICON instead of that one.
    const CARD_CHECK_ICON = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';

    // The printer glyph on the order confirmation, the same one the quote
    // overlay's confirmation carries. Built through the shared icon() helper
    // rather than copied as a raw SVG string: icon(path, 'w-4 h-4') emits
    // byte-for-byte what request-quote-module.js's PRINT_ICON literal does, so
    // the two confirmations draw the identical glyph without a second copy of
    // the path drifting from the first.
    const PRINT_ICON = icon(
        'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v3h10z',
        'w-4 h-4'
    );

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    let priced = null;      // the server's answer: { lines, blocked, totals }
    let customer = null;    // the signed-in profile, or null
    let placing = false;

    // The two halves of the customer's choice, kept apart because they are
    // different facts and the server reads them separately: `paymentMode`
    // decides whether a gateway is involved at all, `paymentMethod` is the
    // offline instrument and is only meaningful when the mode is 'offline'.
    //
    // Both are sent on every submit. Defaulting the mode to 'online' matches
    // the server's own default for a body that omits it.
    let paymentMode = 'online';
    let paymentMethod = DEFAULT_METHOD_KEYS[0];
    let draft = {};

    // The gateway handshake for an order that HAS been created but NOT paid
    // for. Held so a customer who closes the modal can reopen the same
    // Razorpay order rather than placing a second one — see awaitingHTML().
    let pendingPayment = null;

    // ------------------------------------------------------------------
    // THE HANDSHAKE SURVIVES A RELOAD
    // ------------------------------------------------------------------
    // `pendingPayment` above is module state, and module state dies with the
    // document. That was the whole bug: a customer who closed the modal got
    // the "waiting for payment" screen with a working Pay-now button, and the
    // moment they refreshed or navigated away it was gone. start() then found
    // the cart still full — correctly, since nothing had been paid for and
    // clearing it would have thrown away their basket — and repainted the
    // checkout FORM. The next Place Order created a SECOND order for the same
    // goods, and the first sat in 'Pending Payment' forever holding a real
    // order number.
    //
    // So it is written to sessionStorage as it is created and read back at
    // boot. Three deliberate choices:
    //
    //   sessionStorage, not localStorage. The same lifetime rule the guest
    //   cart follows: an unpaid order held open in a tab is this visit's
    //   business, and one resurfacing on a shared machine tomorrow is not.
    //
    //   Keyed per order id INSIDE the value, not spread across keys. There is
    //   at most one order awaiting payment from this page at a time — the
    //   customer cannot reach the form again while one is open — so a single
    //   key that is replaced wholesale cannot accumulate stale entries.
    //
    //   Everything the modal needs, and nothing more: the ids the gateway
    //   already gave this browser, plus the contact block for the prefill.
    //   No card details exist here to leak; they are typed inside Razorpay's
    //   own iframe, which is the point of using it.
    //
    // Every read and write is wrapped, the same rule cart-module.js follows: a
    // browser that throws on storage must degrade to the old in-memory
    // behaviour, not to a checkout page that will not render.
    const PENDING_KEY = 'srk_pending_payment';
    const DRAFT_KEY = 'srk_checkout_draft';

    function recallDraft() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
            return saved && typeof saved === 'object' ? saved : {};
        } catch (error) {
            return {};
        }
    }

    // EMPTY IS NOT A VALUE, and that distinction is the whole of one bug.
    //
    // readForm() reports every field, including the ones nobody has touched,
    // as ''. formHTML()'s `value()` asks whether the draft holds a key at all
    // — and '' is a key it holds — so an untouched field's empty string beat
    // the account fallback standing behind it. The customer who typed their
    // name, followed "Sign in to fill this in" and came back signed in was
    // handed a form with their saved phone, company and delivery address
    // blanked out by the blanks they had left behind: the exact opposite of
    // what the link they clicked promised.
    //
    // So a field the customer has not filled in is dropped rather than stored
    // as empty, and the fallback behind it survives the round trip. A field
    // they deliberately cleared reads the same way and is refilled from the
    // account on the way back, which is the safe direction to be wrong in —
    // showing a saved detail they can edit beats silently losing one.
    function saveDraft() {
        const form = document.getElementById('checkout-form');
        if (form) {
            const values = readForm();
            const typed = {};
            Object.entries(Object.assign({}, values.contact, values.address)).forEach(([key, value]) => {
                if (key === 'password') return;
                if (typeof value === 'string' && value.trim() !== '') typed[key] = value;
            });
            draft = Object.assign(typed, { paymentMode, paymentMethod });
        } else {
            draft = Object.assign({}, draft, { paymentMode, paymentMethod });
        }

        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (error) {}
    }

    function clearDraft() {
        draft = {};
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (error) {}
    }

    function rememberPending(handshake) {
        pendingPayment = handshake;
        try {
            if (handshake) sessionStorage.setItem(PENDING_KEY, JSON.stringify(handshake));
            else sessionStorage.removeItem(PENDING_KEY);
        } catch (error) {
            // In-memory only for this document. The awaiting screen still
            // works; it just will not survive a reload, which is exactly
            // where this page was before.
        }
    }

    // ?resume=<order id> — set by the Pay-now link in the order history.
    // Digits only: this ends up in a URL path on the cancel route and in a
    // lookup, and a shape check here is free.
    function resumeParam() {
        try {
            const value = new URLSearchParams(window.location.search).get('resume');
            return value && /^[0-9]+$/.test(value) ? value : null;
        } catch (error) {
            return null;
        }
    }

    function clearResumeParam() {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('resume');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch (error) {
            // Leaving it in place is harmless — every resume re-asks the
            // server — so a browser without replaceState simply keeps the URL.
        }
    }

    function recallPending() {
        try {
            const raw = sessionStorage.getItem(PENDING_KEY);
            if (!raw) return null;

            const saved = JSON.parse(raw);
            // Anything that cannot actually open a modal is not a resumable
            // order, and keeping it would paint an awaiting screen whose only
            // button fails. Shape-checked rather than trusted: this value has
            // been sitting in a store the customer can edit.
            if (!saved || !saved.order_id || !saved.payment || !saved.payment.key_id || !saved.payment.gateway_order_id) {
                return null;
            }
            return saved;
        } catch (error) {
            return null;
        }
    }

    // The server's answer, never a constant here: the page must not be able to
    // draw one flow while the server runs the other. Read through a function
    // because `priced` is replaced wholesale on every re-price.
    const paymentsEnabled = () => Boolean(priced && priced.payments_enabled);

    // Thumbnails only. Keyed by product id so a line the server priced can
    // find the picture the cart happened to snapshot, and shrug if it cannot.
    let thumbs = new Map();

    // ------------------------------------------------------------------
    // MARKUP — order summary (right column)
    // ------------------------------------------------------------------
    function thumbHTML(id, name) {
        const url = thumbs.get(String(id));
        const label = escapeHtml(name || 'Product');

        if (!url) {
            return '<div class="w-full h-full flex items-center justify-center text-[9px] font-bold text-[#12170f]/25 text-center leading-tight p-1">' + label + '</div>';
        }

        return '<img src="' + escapeHtml(url) + '" alt="" loading="lazy"' +
            ' class="w-full h-full object-contain mix-blend-multiply"' +
            ' onerror="this.style.visibility=\'hidden\';" />';
    }

    function lineHTML(line) {
        return [
            '<li class="flex items-start gap-3 py-4 border-b border-[#12170f]/[0.07] last:border-0">',
            '    <div class="w-14 h-14 shrink-0 bg-[#f1f5f9] rounded-sm overflow-hidden flex items-center justify-center p-1.5">',
            '        ' + thumbHTML(line.product_id, line.product_name),
            '    </div>',
            '    <div class="min-w-0 flex-1">',
            '        <p class="text-sm font-bold text-[#12170f] leading-snug">' + escapeHtml(line.product_name) + '</p>',
            '        <p class="text-xs text-[#1f271b]/50 mt-1">' + escapeHtml(formatAmount(line.unit_price)) + ' &times; ' + line.quantity + '</p>',
            '    </div>',
            '    <p class="text-sm font-bold text-[#12170f] shrink-0 tabular-nums">' + escapeHtml(formatAmount(line.line_total)) + '</p>',
            '</li>'
        ].join('\n');
    }

    // A blocked line is shown, not hidden. The customer put it in the cart and
    // is looking for it; silently dropping it from the list would read as the
    // site losing things.
    function blockedHTML(item) {
        return [
            '<li class="flex items-start gap-3 py-4 border-b border-[#12170f]/[0.07] last:border-0 opacity-70">',
            '    <div class="w-14 h-14 shrink-0 bg-[#f1f5f9] rounded-sm overflow-hidden flex items-center justify-center p-1.5 grayscale">',
            '        ' + thumbHTML(item.product_id, item.name),
            '    </div>',
            '    <div class="min-w-0 flex-1">',
            '        <p class="text-sm font-bold text-[#12170f] leading-snug line-through decoration-[#12170f]/30">' + escapeHtml(item.name || 'This product') + '</p>',
            '        <p class="text-xs text-[#b45309] mt-1 leading-relaxed">' + escapeHtml(item.message) + '</p>',
            '    </div>',
            '    <button type="button" data-remove="' + escapeHtml(item.product_id) + '"',
            '        class="shrink-0 text-[11px] font-bold text-[#1f271b]/50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-sm px-1">Remove</button>',
            '</li>'
        ].join('\n');
    }

    function totalsRow(label, value, options) {
        const opts = options || {};

        return [
            '<div class="flex items-center justify-between gap-4 ' + (opts.strong ? 'pt-3 mt-1 border-t border-[#12170f]/10' : '') + '">',
            '    <span class="' + (opts.strong ? 'text-sm font-bold text-[#12170f]' : 'text-xs text-[#1f271b]/60') + '">' + escapeHtml(label) + '</span>',
            '    <span class="' + (opts.strong ? 'text-lg font-bold text-[#12170f]' : 'text-xs font-bold text-[#1f271b]/80') + ' tabular-nums">' + escapeHtml(value) + '</span>',
            '</div>'
        ].join('\n');
    }

    function summaryHTML() {
        const totals = priced.totals;
        const gstLabel = 'GST (' + Math.round(totals.gst_rate * 100) + '%)';

        const shippingValue = totals.shipping > 0
            ? formatAmount(totals.shipping)
            : (totals.shipping_is_free ? 'Free' : '—');

        return [
            '<aside class="lg:sticky lg:top-[96px]">',
            '    <div class="bg-white border border-[#12170f]/10 rounded-sm">',
            '        <div class="px-5 md:px-6 pt-6 pb-2">',
            '            <span class="' + EYEBROW_CLASSES + '">Order Summary</span>',
            '            <h2 class="text-xl font-bold tracking-tight mt-2">' +
                         priced.lines.length + (priced.lines.length === 1 ? ' item' : ' items') + '</h2>',
            '        </div>',

            '        <ul class="px-5 md:px-6 max-h-[340px] overflow-y-auto no-scrollbar">',
            priced.lines.map(lineHTML).join('\n'),
            priced.blocked.map(blockedHTML).join('\n'),
            '        </ul>',

            '        <div class="px-5 md:px-6 py-5 bg-[#f8fafc] border-t border-[#12170f]/10 space-y-2.5">',
            totalsRow('Subtotal', formatAmount(totals.subtotal)),
            totalsRow('Delivery', shippingValue),
            totalsRow(gstLabel, formatAmount(totals.tax)),
            totalsRow('Total', formatAmount(totals.total), { strong: true }),
            totals.shipping > 0
                ? '            <p class="text-[11px] text-[#1f271b]/45 pt-1 leading-relaxed">Delivery is free on orders over ' + escapeHtml(formatAmount(totals.shipping_free_above)) + '.</p>'
                : '',
            '        </div>',

            '        <div class="px-5 md:px-6 pb-6 pt-5">',
            '            ' + bannerHTML('checkout-error'),
            '            <button type="submit" form="checkout-form" id="checkout-submit"',
            '                class="' + PRIMARY_BUTTON_CLASSES + ' w-full text-base py-4">Place Order</button>',
            // What happens next, in the order it happens.
            '            <p class="text-[11px] text-[#1f271b]/50 mt-3 leading-relaxed">Your order reference will appear on this page, and our team will use your contact details to arrange the next steps.</p>',
            '        </div>',
            '    </div>',
            '</aside>'
        ].filter(line => line !== '').join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — details form (left column)
    // ------------------------------------------------------------------
    function signedInNoticeHTML() {
        if (!customer) {
            return [
                '<div class="mb-8 p-4 bg-white border border-[#12170f]/10 rounded-sm flex flex-wrap items-center justify-between gap-3">',
                '    <p class="text-xs text-[#1f271b]/60">Already ordered from us before?</p>',
                '    <a href="/store/store.html?returnTo=%2Fstore%2Fcheckout.html#account" class="text-xs font-bold text-[#d4af37] hover:underline">Sign in to fill this in</a>',
                '</div>'
            ].join('\n');
        }

        return [
            '<div class="mb-8 p-4 bg-[#d4af37]/[0.07] border border-[#d4af37]/25 rounded-sm">',
            '    <p class="text-xs text-[#1f271b]/70">Signed in as <span class="font-bold text-[#12170f]">' + escapeHtml(customer.email) + '</span>. Your saved details are filled in below — changes here update your account too.</p>',
            '</div>'
        ].join('\n');
    }

    // One card. `descriptor` is either ONLINE_METHOD or one of
    // offlineMethods(), and the only thing that differs is what a click means —
    // which is why both carry data-payment-mode and the handler reads it
    // rather than inferring the mode from the key.
    //
    // The two are drawn IDENTICALLY, which they were not before: the online
    // card used to be a wide col-span-full banner sitting over a row of small
    // offline squares, because it was one option against four and the layout
    // said so. It is now one option against one, and giving either of them the
    // larger shape would be the page leaning on the customer over a choice
    // that is genuinely theirs — a shop nudging you towards paying up front,
    // or away from it. Same size, same weight, the selection ring the only
    // difference.
    function paymentMethodCardHTML(descriptor) {
        const isOnline = descriptor.mode === 'online';
        const selected = isOnline
            ? paymentMode === 'online'
            : paymentMode === 'offline' && descriptor.key === paymentMethod;

        return [
            '<button type="button" data-payment-mode="' + descriptor.mode + '"' +
                (isOnline ? '' : ' data-payment-method="' + escapeHtml(descriptor.key) + '"') +
                ' aria-pressed="' + selected + '"',
            '    class="payment-method-card relative flex flex-col justify-center text-center gap-1.5 px-4 ' +
                'bg-white border rounded-md py-5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] ' +
                (selected ? 'border-[#d4af37] ring-2 ring-[#d4af37] bg-[#d4af37]/[0.05]' : 'border-[#12170f]/15 hover:border-[#d4af37]/60') + '">',
            selected
                ? '    <span class="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#d4af37] text-white flex items-center justify-center shadow-sm">' + CARD_CHECK_ICON + '</span>'
                : '',
            // Tailwind's preflight makes an svg display:block, so the glyph
            // pins itself to the left of a stretched column child no matter what
            // text-center says. justify-center on the wrapper is what actually
            // centres it over the label — visible the moment there is one
            // full-width card rather than a row of narrow ones.
            '    <span class="flex justify-center text-[#1f271b]/60 shrink-0">' + icon(descriptor.path, 'w-6 h-6') + '</span>',
            '    <span class="text-sm font-bold text-[#12170f]">' + escapeHtml(descriptor.label) + '</span>',
            '    <span class="text-[11px] text-[#1f271b]/45">' + escapeHtml(descriptor.hint) + '</span>',
            '</button>'
        ].filter(line => line !== '').join('\n');
    }

    // WHICH OPTIONS EXIST DEPENDS ON THE SERVER, NOT ON A CONSTANT HERE.
    //
    // Gateway on:  Pay Now and Pay on Receipt.
    // Gateway off: Pay on Receipt alone — there is nothing to pay *with* now,
    //              and a Pay Now card that opened no modal would be a lie.
    //
    // The offline half is still whatever the server published rather than a
    // literal 'Cash on Delivery' typed here: the server owns that vocabulary
    // and this page renders it, so a second offline instrument would appear
    // without an edit here. What has gone is the filter that used to drop
    // 'UPI' from the offline list when the gateway was up — the offline list
    // no longer carries a UPI to collide with the gateway's.
    function availableMethods() {
        if (!paymentsEnabled()) return offlineMethods();

        return [ONLINE_METHOD].concat(offlineMethods());
    }

    function paymentMethodGridHTML() {
        return availableMethods().map(paymentMethodCardHTML).join('\n');
    }

    // ONE SECTION NOW, NOT TWO.
    //
    // This used to be either/or — with the gateway on, the offline picker was
    // not built at all, on the reasoning that asking "how do you plan to
    // settle?" and then opening a card modal is two promises in one form.
    // That reasoning was right about the *wording* and wrong about the
    // *choice*: it left a customer who wanted Cash on Delivery with no way to
    // say so, on a site whose customers routinely pay against an invoice.
    //
    // So there is one picker, and the promise is made honest by the card
    // labels instead — "Pay Now" says a payment window is coming, the others
    // say it is not — and by the submit button, which changes wording with the
    // selection.
    function paymentSectionHTML() {
        const online = paymentsEnabled();

        // The column count follows the number of cards rather than being
        // fixed: two abreast when the gateway is up, one full-width card when
        // it is not. A lone card in a two-column grid reads as a row with
        // something missing from it — the customer looks for the option that
        // is not there.
        const columns = availableMethods().length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1';

        return [
            '<section class="mb-10">',
            '    ' + sectionHeading('03', 'Payment Method', online ? 'Pay now, or pay when it arrives' : 'How you plan to settle'),
            '    <div id="checkout-payment-methods" role="group" aria-label="Payment method" class="grid ' + columns + ' gap-3">',
                     paymentMethodGridHTML(),
            '    </div>',
            '    <p id="checkout-payment-note" class="text-[11px] text-[#1f271b]/45 mt-3 leading-relaxed">' + paymentNoteHTML() + '</p>',
            '</section>'
        ].join('\n');
    }

    // The one line under the grid, which has to say something different for
    // each branch — "card details never reach this site" is reassuring under
    // Pay Now and simply untrue under Pay on Receipt.
    function paymentNoteHTML() {
        if (paymentMode === 'online') {
            return 'UPI, cards and EMI are all offered on the next screen — you pick there, not here. You will be taken to our payment provider to complete this securely; card details are entered on their page and never reach this site. Your order is created first and confirmed only once payment clears.';
        }

        return 'No payment is taken now. Pay in cash when your order is delivered — we will confirm the amount and the delivery date with your order confirmation.';
    }

    function formHTML() {
        const c = customer || {};
        // An empty draft entry is treated as absent, not as an answer. saveDraft()
        // no longer writes one, but a draft stored by an older copy of this page
        // is still sitting in some customers' sessionStorage and would otherwise
        // go on blanking the account details it was never meant to outrank.
        const value = (key, fallback) => {
            const held = draft[key];
            return (typeof held === 'string' && held.trim() !== '') ? held : (fallback || '');
        };

        return [
            '<form autocomplete="on" data-srk-password-manager="allow" id="checkout-form" novalidate>',
            '    ' + signedInNoticeHTML(),

            '    <section class="mb-10">',
            '        ' + sectionHeading('01', 'Contact Information', 'How we confirm your order'),
            '        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
            '            ' + textFieldHTML({ id: 'checkout-name', label: 'Full Name', placeholder: 'Your name', required: true, value: value('name', c.name) }),
            '            ' + textFieldHTML({ id: 'checkout-phone', label: 'Phone Number', type: 'tel', placeholder: '+91 98765 43210', required: true, value: value('phone', c.phone) }),
            // Read-only rather than absent when signed in: the customer should
            // see which address the confirmation is going to, and changing the
            // email on an account is a verified flow this page does not own.
            '            ' + textFieldHTML({ id: 'checkout-email', label: 'Email Address', type: 'email', placeholder: 'you@business.com', required: true, value: customer ? c.email : value('email', c.email), readonly: !!customer, autocomplete: customer ? undefined : 'username' }),
            '            ' + textFieldHTML({ id: 'checkout-company', label: 'Business Name', placeholder: 'Optional', value: value('company', c.company) }),
            customer
                ? ''
                : '            ' + textFieldHTML({ id: 'checkout-password', label: 'Create Account Password', type: 'password', placeholder: 'At least 8 characters', required: true, maxlength: 128, autocomplete: 'new-password' }),
            '        </div>',
            customer
                ? '        <p class="text-[11px] text-[#1f271b]/45 mt-3">Contact us to change the email on your account.</p>'
                : '        <p class="text-[11px] text-[#1f271b]/45 mt-3">New customer? This password protects the account created with your order. Already have an account? Sign in above first.</p>',
            '    </section>',

            '    <section class="mb-10">',
            '        ' + sectionHeading('02', 'Delivery Address', 'Where this order is sent'),
            '        <div class="grid grid-cols-1 gap-5">',
            '            ' + textAreaHTML({ id: 'checkout-address', label: 'Street Address', placeholder: 'Building, street, area', required: true, rows: 2, value: value('address_line', c.address_line) }),
            '            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
            '                ' + textFieldHTML({ id: 'checkout-city', label: 'City', placeholder: 'Rajkot', required: true, value: value('city', c.city) }),
            '                ' + textFieldHTML({ id: 'checkout-state', label: 'State', placeholder: 'Gujarat', required: true, value: value('state', c.state) }),
            '                ' + textFieldHTML({ id: 'checkout-postal', label: 'PIN Code', placeholder: '360002', required: true, value: value('postal_code', c.postal_code) }),
            '                ' + textFieldHTML({ id: 'checkout-country', label: 'Country', placeholder: 'India', value: value('country', c.country || 'India') }),
            '            </div>',
            '        </div>',
            '    </section>',

            '    ' + paymentSectionHTML(),
            '</form>'
        ].filter(line => line !== '').join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — whole-page states
    // ------------------------------------------------------------------
    // `actions` is an array, one entry per button, in the order the customer
    // should read them: what we want them to do, then the aside, then the way
    // out. The row itself is laid out by #checkout-actions-styles above —
    // nothing here decides a width, so one state cannot arrange its buttons
    // differently from its neighbours by accident.
    function noticeHTML(title, message, actions) {
        const buttons = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);

        return [
            '<div class="py-20 text-center max-w-xl mx-auto">',
            '    <div class="w-14 h-14 mx-auto mb-6 rounded-full bg-[#d4af37]/10 flex items-center justify-center text-[#d4af37]">' + PACKAGE_ICON + '</div>',
            '    <h2 class="text-2xl font-bold tracking-tight mb-3">' + escapeHtml(title) + '</h2>',
            '    <p class="text-sm text-[#1f271b]/60 mb-8 leading-relaxed max-w-md mx-auto">' + message + '</p>',
            '    <div id="checkout-actions">' + buttons.join('') + '</div>',
            '</div>'
        ].join('\n');
    }

    const backToStore = '<a href="/store/store.html" class="' + SECONDARY_BUTTON_CLASSES + '">Back to store</a>';
    // id, because the click has work to do before the navigation it starts —
    // see the handoff in the root click listener at the bottom of this file.
    const toQuote = '<a href="/store/store.html#quote" id="checkout-to-quote" class="' + PRIMARY_BUTTON_CLASSES + '">Request a quote</a>';

    function emptyHTML() {
        return noticeHTML('Your cart is empty', 'Add something from the store and it will show up here.', [backToStore]);
    }

    // ---- The three ways a resumed order turns out not to be resumable ------
    //
    // All reached only by following a Pay-now link from the order history,
    // which is why each says what happened to THAT order rather than silently
    // dropping the customer on a checkout form. Arriving at a fresh form after
    // clicking "pay for order ORD-2026-1015" reads as the site having lost it.

    function notFoundHTML() {
        return noticeHTML(
            'We could not find that order',
            'It may belong to a different account, or it may have been removed. Your orders are listed in your account.',
            ['<a href="/store/store.html#account" class="' + PRIMARY_BUTTON_CLASSES + '">View my orders</a>', backToStore]
        );
    }

    function cancelledHTML(reference) {
        return noticeHTML(
            'That order was cancelled',
            'Order <span class="font-bold text-[#12170f]">' + escapeHtml(reference || '') + '</span> is no longer open, so there is nothing to pay. ' +
            'Nothing was charged. You are welcome to order the same items again.',
            ['<a href="/store/store.html" class="' + PRIMARY_BUTTON_CLASSES + '">Back to store</a>',
             '<a href="/store/store.html#account" class="' + SECONDARY_BUTTON_CLASSES + '">View my orders</a>']
        );
    }

    // Awaiting payment, but the server offers no handshake — online payment was
    // switched off after the order was placed. Nothing on this page can settle
    // it, and pretending otherwise would give the customer a button that fails.
    function unpayableHTML(reference) {
        return noticeHTML(
            'This order cannot be paid online',
            'Order <span class="font-bold text-[#12170f]">' + escapeHtml(reference || '') + '</span> is open and unpaid, but online payment is not available for it. ' +
            'Get in touch and we will settle it with you directly.',
            ['<a href="/contact.html" class="' + PRIMARY_BUTTON_CLASSES + '">Contact us</a>', backToStore]
        );
    }

    function nothingPricedHTML() {
        const list = priced.blocked
            .map(item => '<li class="text-sm text-[#12170f] font-bold">' + escapeHtml(item.name || 'A product') + '</li>')
            .join('\n');

        return noticeHTML(
            'These need a quote',
            'Nothing in your cart carries a listed price, so there is no total to place an order against. Send it as a quote request and our team will come back with pricing and availability.' +
            '<ul class="mt-5 space-y-1">' + list + '</ul>',
            [toQuote, backToStore]
        );
    }

    // Print sits between the two, next to the action it belongs with: it is
    // about the order just placed, where "Back to store" is the way out.
    // That order is also what puts it beside "View my orders" on the top row
    // of #checkout-actions' grid, with the way out spanning the row beneath —
    // see the stylesheet above for why the layout lives there and not here.
    const printOrder = '<button type="button" id="checkout-print" class="' +
        SECONDARY_BUTTON_CLASSES + ' gap-2">' + PRINT_ICON +
        '<span>Print / Download PDF</span></button>';

    function placedHTML(result) {
        return noticeHTML(
            'Order placed',
            'Your reference is <span class="font-bold text-[#12170f]">' + escapeHtml(result.reference) + '</span>. ' +
            'Keep this reference for your records. Our team will contact you using the details supplied when the order is ready to progress.',
            [
                '<a href="/store/store.html#account" class="' + PRIMARY_BUTTON_CLASSES + '">View my orders</a>',
                printOrder,
                backToStore
            ]
        );
    }

    function failedHTML(message) {
        return noticeHTML(
            'That did not go through',
            escapeHtml(message || 'Your order could not be placed.') + ' No order has been created, so nothing has been lost — your cart is exactly as you left it.',
            ['<button type="button" id="checkout-retry" class="' + PRIMARY_BUTTON_CLASSES + '">Try again</button>', backToStore]
        );
    }

    // THE ORDER EXISTS AND IS UNPAID. This is the state a customer lands in by
    // closing the payment modal, and getting it wrong is expensive in both
    // directions: tell them nothing happened and they will place a second
    // order for the same goods; tell them it is done and they will wait for a
    // delivery nobody is preparing.
    //
    // So it says exactly what is true, and the button reopens the SAME
    // Razorpay order rather than creating another one — which is the whole
    // reason pendingPayment is kept in module state. The cart is deliberately
    // NOT cleared here: nothing has been paid for yet.
    function awaitingHTML(reference, message) {
        return noticeHTML(
            'Your order is waiting for payment',
            (message ? escapeHtml(message) + ' ' : '') +
            'Order <span class="font-bold text-[#12170f]">' + escapeHtml(reference || '') + '</span> has been created and is being held for you. ' +
            'It will not be processed until payment clears — nothing has been charged so far. ' +
            'You can pay for it here or from your order history at any time.',
            [
                '<button type="button" id="checkout-resume-payment" class="' + PRIMARY_BUTTON_CLASSES + '">Pay now</button>',
                // THE WAY OUT. Without it the only thing a customer who had
                // changed their mind could do was leave the order sitting
                // unpaid forever and start another one — which is the exact
                // duplicate this whole screen exists to prevent, arrived at
                // from the other direction.
                //
                // Second, not first: the common case on this screen is a
                // payment that was interrupted and is about to be retried, and
                // Cancel should never be the button under the cursor by
                // default.
                '<button type="button" id="checkout-cancel-order" class="' + SECONDARY_BUTTON_CLASSES + '">Cancel this order</button>',
                backToStore
            ]
        );
    }

    // Money moved but our server could not confirm it in time. Never shown as
    // a failure: telling someone their payment failed when it did not is how
    // a customer pays twice.
    function settlingHTML(message) {
        return noticeHTML(
            'Payment received — confirming',
            escapeHtml(message || 'Your payment went through but we are still confirming it.') +
            ' Please do not pay again. It will appear under your orders shortly.',
            [
                '<a href="/store/store.html#account" class="' + PRIMARY_BUTTON_CLASSES + '">View my orders</a>',
                backToStore
            ]
        );
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    function paint(html) {
        root.innerHTML = html;
        enhance(root);
        return root;
    }

    function paintCheckout() {
        paint([
            '<div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-10 lg:gap-14 items-start">',
            '    <div>' + formHTML() + '</div>',
            '    ' + summaryHTML(),
            '</div>'
        ].join('\n'));

        const form = document.getElementById('checkout-form');
        if (form) {
            form.addEventListener('submit', onPlaceOrder);

            // Clearing an error as the visitor starts fixing it is what the
            // quote and account forms do.
            form.addEventListener('input', (event) => {
                const field = event.target;
                if (field && field.classList && field.classList.contains('border-red-500')) {
                    chrome.clearFieldError(field);
                }
                saveDraft();
            });
            form.addEventListener('change', saveDraft);
        }

    }

    // ------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------
    async function price(items) {
        const response = await fetch('/api/checkout/summary', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items.map(line => ({ product_id: line.id, quantity: line.quantity })) })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload && payload.error) || 'Could not price your cart.');

        return payload;
    }

    // ------------------------------------------------------------------
    // AN ORDER LEFT UNPAID COMES BACK BEFORE THE FORM DOES
    // ------------------------------------------------------------------
    // Runs before anything else in start(). If this browser left an order
    // awaiting payment, that order — not a fresh checkout form — is what the
    // page owes the customer, because the alternative is placing a second one
    // for the same goods.
    //
    // THE SERVER IS ASKED, AND ITS ANSWER WINS. The saved copy is only what
    // this browser last knew, and everything interesting can have happened
    // since: the webhook may have settled it while the tab was closed, an
    // administrator may have cancelled it, the sweep may have expired it. It
    // also sits in a store the customer can edit, so it is a hint about which
    // order to ask about and never the authority on its state.
    //
    // A failed lookup falls back to the saved copy rather than to the form.
    // Offline, or a session that has since expired, is not evidence that the
    // order went away — and showing the form on a guess is what creates the
    // duplicate.
    //
    // Returns true when it has painted something and start() should stop.
    //
    // TWO WAYS IN, AND THE URL OUTRANKS THE STORE.
    //
    //   ?resume=<order id>   the customer clicked Pay now in their order
    //                        history. That page cannot open the modal itself —
    //                        store.html loads neither payment-module.js nor
    //                        Razorpay's CSP grant, and widening either so an
    //                        account panel could take a payment would put a
    //                        third-party script source on the page every
    //                        visitor lands on. So it sends them here, which
    //                        already has the script, the grant and this screen.
    //
    //   sessionStorage       this same tab left an order unpaid.
    //
    // The parameter wins, because it names an order the customer just asked
    // for by hand.
    async function resumeIfPending() {
        const asked = resumeParam();
        const saved = recallPending();
        const wantedId = asked || (saved && saved.order_id) || null;

        if (wantedId === null) return false;

        // Back into module state immediately, not only into the screen.
        // recallPending() reads the store; it does not restore the variable
        // that startPayment() and cancelPendingOrder() actually work from. On
        // the offline path below — server unreachable, saved copy used — the
        // awaiting screen would otherwise paint with a Pay-now button that
        // reported "online payment is unavailable" the moment it was pressed,
        // which is the failure this whole path exists to remove.
        if (saved) pendingPayment = saved;

        // Consumed once. Left in place it would survive a cancel and re-resume
        // an order on the next repaint — harmless, since the server is asked
        // every time and would answer 'Cancelled', but it also leaves a URL
        // that means something it no longer does. Same reasoning as
        // request-quote-module.js stripping #quote as it opens.
        if (asked) clearResumeParam();

        let live = null;
        let answered = false;

        try {
            const response = await fetch('/api/orders/mine', { credentials: 'include' });
            if (response.ok) {
                answered = true;
                const orders = await response.json().catch(() => null);
                live = Array.isArray(orders)
                    ? orders.find(order => String(order.id) === String(wantedId)) || null
                    : null;
            }
        } catch (error) {
            // Offline. `answered` stays false.
        }

        // Asked and answered: no such order in this customer's history. It was
        // never theirs, or it is gone.
        if (answered && !live) {
            rememberPending(null);
            if (asked) return paint(notFoundHTML()), true;
            return false;
        }

        // Followed a Pay-now link and the server could not be reached. There is
        // no saved handshake to fall back on, and painting the checkout form
        // would invite the duplicate this whole path exists to prevent.
        if (!live && !saved) {
            paint(failedHTML('We could not load that order. Check your connection and try again.'));
            return true;
        }

        if (live) {
            if (live.status === 'Cancelled') {
                rememberPending(null);
                if (asked) return paint(cancelledHTML(live.reference)), true;
                return false;
            }

            // Anything past 'Pending Payment' means the money landed — most
            // likely the webhook settling it while this tab was shut, which is
            // precisely the case the browser callback never covers. Show the
            // confirmation, and clear the basket here because this is the first
            // moment the page has learned it was paid for.
            if (live.status !== 'Pending Payment') {
                rememberPending(null);
                cart.clear();
                paint(placedHTML({ reference: live.reference }));
                return true;
            }

            // Still awaiting. The server's handshake beats the stored one —
            // same order, read off the row rather than out of a store the
            // customer can edit.
            if (live.payment) {
                rememberPending({
                    order_id: live.id,
                    reference: live.reference,
                    payment: live.payment,
                    contact: (saved && saved.contact) || {}
                });
            } else {
                // Awaiting payment with no handshake: the gateway was switched
                // off after this order was placed. Nothing here can settle it.
                return paint(unpayableHTML(live.reference)), true;
            }
        }

        paint(awaitingHTML(
            (live && live.reference) || saved.reference,
            asked ? '' : 'You have an order here that was not paid for.'
        ));
        return true;
    }

    async function start() {
        paint('<div class="py-24 text-center"><p class="text-sm text-[#1f271b]/50">Loading your order…</p></div>');

        // Before the cart is even consulted: an unpaid order outranks a fresh
        // one, and pricing the basket first would only paint a form over it.
        if (await resumeIfPending()) return;

        // The cart is not necessarily in hand yet. For a signed-in customer it
        // lives on the server now (cart_items, migration 017), so cart.items()
        // reads empty until GET /api/cart has landed — and an empty read here
        // paints "Your cart is empty" over a real order the customer has just
        // clicked through to pay for. Guarded rather than assumed, so a browser
        // still holding a pre-017 copy of cart-module.js degrades to the old
        // behaviour instead of throwing.
        if (cart.ready) await cart.ready;

        const items = cart.items();
        if (!items.length) return paint(emptyHTML());

        thumbs = new Map(items.map(line => [String(line.id), line.image_url]));

        // Both in flight at once: neither depends on the other, and the form
        // cannot paint until both have landed anyway.
        let profile = null;
        try {
            const [answer] = await Promise.all([price(items), account.ready.then(() => { profile = account.current(); })]);
            priced = answer;
        } catch (error) {
            console.error('Checkout could not start.', error);
            return paint(failedHTML(error.message));
        }

        customer = profile;
        draft = recallDraft();

        if (draft.paymentMode === 'online' || draft.paymentMode === 'offline') paymentMode = draft.paymentMode;
        if (typeof draft.paymentMethod === 'string') paymentMethod = draft.paymentMethod;

        if (!priced.lines.length) return paint(nothingPricedHTML());

        // `paymentMode` defaults to 'online' because that is the server's own
        // default for a body that omits it, and it is what most customers
        // want. But the default is only reachable when the gateway is up: with
        // payments off there is no online card to render, and leaving the mode
        // on 'online' would paint the Pay on Receipt card with NONE of the
        // cards selected — the grid would look like it had simply forgotten
        // the choice. `priced` is the first point at which the answer is known.
        if (!paymentsEnabled()) paymentMode = 'offline';

        // The instrument in hand has to be one the SERVER will accept. It is
        // seeded from DEFAULT_METHOD_KEYS before the summary lands, and the
        // summary is the first moment the real list is known — so a key the
        // server has since dropped is corrected here rather than being posted
        // and silently rewritten to PAYMENT_METHODS[0] as the order is written.
        if (methodKeys().indexOf(paymentMethod) === -1) paymentMethod = methodKeys()[0];

        paintCheckout();
    }

    // ------------------------------------------------------------------
    // PLACING THE ORDER
    // ------------------------------------------------------------------
    const REQUIRED = [
        { id: 'checkout-name', message: 'Enter your name.' },
        { id: 'checkout-email', message: 'Enter your email address.' },
        { id: 'checkout-phone', message: 'Enter a phone number we can reach you on.' },
        { id: 'checkout-password', message: 'Create a password.' },
        { id: 'checkout-address', message: 'Enter a street address.' },
        { id: 'checkout-city', message: 'Enter a city.' },
        { id: 'checkout-state', message: 'Enter a state.' },
        { id: 'checkout-postal', message: 'Enter a PIN code.' }
    ];

    function readForm() {
        const value = (id) => {
            const field = document.getElementById(id);
            return field ? field.value.trim() : '';
        };

        return {
            contact: {
                name: value('checkout-name'),
                email: value('checkout-email'),
                phone: value('checkout-phone'),
                company: value('checkout-company'),
                password: (() => {
                    const field = document.getElementById('checkout-password');
                    return field ? field.value : '';
                })()
            },
            address: {
                address_line: value('checkout-address'),
                city: value('checkout-city'),
                state: value('checkout-state'),
                postal_code: value('checkout-postal'),
                country: value('checkout-country') || 'India'
            }
        };
    }

    function showBanner(message) {
        const banner = document.getElementById('checkout-error');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.remove('hidden');
    }

    // Split from setBusy so changing the payment method can relabel the button
    // WITHOUT touching `placing`. setBusy(false) would have cleared it, and a
    // card click mid-submit would then have re-enabled the button under a
    // request that was still in flight — a second order, one click away.
    function refreshSubmitButton() {
        const button = document.getElementById('checkout-submit');
        if (!button) return;

        button.disabled = placing;

        // Under the gateway the button is a promise about what happens next,
        // and "Place Order" understates it — the very next thing the customer
        // sees is a payment window. Saying so avoids the surprise.
        //
        // Keyed on the SELECTION, not on whether the gateway exists. Under the
        // old either/or this could read the deployment flag, because the flag
        // decided the flow; now the customer does, and "Continue to Payment"
        // over a Cash on Delivery order would be a promise the next click does
        // not keep.
        const online = paymentsEnabled() && paymentMode === 'online';

        button.textContent = placing
            ? (online ? 'Opening payment…' : 'Placing your order…')
            : (online ? 'Continue to Payment' : 'Place Order');
    }

    function setBusy(busy) {
        placing = busy;
        refreshSubmitButton();
    }

    async function onPlaceOrder(event) {
        event.preventDefault();
        if (placing) return;

        clearErrorsIn(root, 'checkout-error');

        let firstBad = null;
        REQUIRED.forEach(entry => {
            const field = document.getElementById(entry.id);
            if (!field || field.value.trim()) return;

            fieldError(field, entry.message);
            if (!firstBad) firstBad = field;
        });

        if (firstBad) {
            firstBad.focus({ preventScroll: true });
            firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
            showBanner('Check the highlighted fields and try again.');
            return;
        }

        const passwordField = document.getElementById('checkout-password');
        if (passwordField && (passwordField.value.length < 8 || passwordField.value.length > 128)) {
            fieldError(passwordField, passwordField.value.length < 8
                ? 'Use at least 8 characters.'
                : 'Use no more than 128 characters.');
            passwordField.focus({ preventScroll: true });
            passwordField.scrollIntoView({ block: 'center', behavior: 'smooth' });
            showBanner('Check the highlighted fields and try again.');
            return;
        }

        setBusy(true);

        const body = readForm();
        // Ids and quantities only. Everything that becomes money is the
        // server's to decide — see the header.
        body.items = cart.items().map(line => ({ product_id: line.id, quantity: line.quantity }));
        // THE SELECTION, BOTH HALVES OF IT.
        //
        // `payment_mode` decides the flow: 'online' creates a Razorpay order
        // and returns a handshake, 'offline' places the order outright and
        // returns none. The server re-decides this itself (`payOnline` in
        // POST /api/checkout) rather than trusting it — a mode of 'online'
        // when the gateway is off falls back to offline instead of failing.
        //
        // `payment_method` is the offline instrument and is what lands in
        // payments.payment_method. It is sent even when the mode is online,
        // where the server ignores it: the instrument for a gateway payment is
        // whatever Razorpay reports at capture, not what was guessed here.
        body.payment_mode = paymentsEnabled() ? paymentMode : 'offline';
        body.payment_method = paymentMethod;

        let response, payload;
        try {
            response = await fetch('/api/checkout', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            payload = await response.json().catch(() => null);
        } catch (error) {
            console.error('Checkout request failed.', error);
            setBusy(false);
            showBanner('Could not reach the server. Check your connection and try again.');
            return;
        }

        if (!response.ok) {
            setBusy(false);

            // The catalogue moved under the customer between pricing and
            // placing. Re-price rather than arguing: start() will show the
            // struck-through lines and the new total.
            if (response.status === 409 && payload && payload.blocked) {
                showBanner('Some items changed while you were filling this in. We have updated your order below.');
                start();
                return;
            }

            const field = payload && payload.field ? document.getElementById('checkout-' + fieldAlias(payload.field)) : null;
            if (field) {
                fieldError(field, payload.error);
                field.focus({ preventScroll: true });
                return;
            }

            showBanner((payload && payload.error) || 'Your order could not be placed.');
            return;
        }

        // THE ORDER NOW EXISTS. What it does not yet have, under the gateway
        // flow, is money against it — so this is the one place the two flows
        // genuinely diverge.
        //
        // Offline: the order is complete as far as this page is concerned.
        // Gateway: `payment` is the handshake, and the order sits in
        // 'Pending Payment' until the SERVER confirms a real capture. The cart
        // stays exactly where it is until then.
        if (payload && payload.payment) {
            // The contact block is snapshotted here, not read at open time.
            // By the time Pay now is pressed on the awaiting screen the form
            // has been repainted away, and readForm() would hand back empty
            // strings — so the modal would lose its prefill precisely on the
            // retry where the customer least wants to retype.
            const paymentContact = Object.assign({}, body.contact);
            delete paymentContact.password;
            rememberPending(Object.assign({}, payload, { contact: paymentContact }));
            clearDraft();
            return startPayment();
        }

        // Only once the server has confirmed. Clearing earlier would lose the
        // basket on a request that then failed.
        cart.clear();
        clearDraft();
        paint(placedHTML(payload));
    }

    // Opens the gateway for whatever is in pendingPayment — a fresh order, or
    // one the customer closed the modal on and came back to.
    function startPayment() {
        if (!pendingPayment || !window.storePayment) {
            setBusy(false);
            showBanner('Online payment is unavailable right now. Please try again in a moment.');
            return;
        }

        const order = pendingPayment;
        setBusy(true);

        window.storePayment.pay({
            orderId: order.order_id,
            reference: order.reference,
            payment: order.payment,
            contact: order.contact || {},

            // The SERVER said so. This is the only path that clears the cart.
            onPaid: (result) => {
                rememberPending(null);
                setBusy(false);
                cart.clear();
                paint(placedHTML({ reference: (result && result.reference) || order.reference }));
            },

            // One attempt failed and the modal is still open on its retry
            // step. A banner, not a repaint — repainting would pull the page
            // out from under a customer who is mid-payment.
            onAttemptFailed: (message) => showBanner(message),

            // Closed without paying. The order is real and unpaid, and the
            // screen says so rather than pretending either way.
            onDismissed: () => {
                setBusy(false);
                paint(awaitingHTML(order.reference, 'You closed the payment window before it finished.'));
            },

            // `info.settling` is the module's structured verdict on whether
            // money may already have moved — never inferred from the wording.
            onFailed: (message, info) => {
                setBusy(false);

                // The provider took the payment but our server has not managed
                // to confirm it yet. This must never be presented as a
                // failure: that is how a customer pays twice.
                if (info && info.settling) {
                    rememberPending(null);
                    cart.clear();
                    return paint(settlingHTML(message));
                }

                paint(awaitingHTML(order.reference, message));
            }
        });
    }

    // Closes out an order the customer has decided not to pay for.
    //
    // The cart is deliberately LEFT ALONE. Cancelling an unpaid order is a
    // decision about the order, not about the basket — and the basket is what
    // start() repaints the form from, so a customer who cancels because they
    // wanted to change something lands straight back on a filled checkout
    // rather than an empty store. Emptying it here would be the module
    // deciding they were finished shopping.
    async function cancelPendingOrder(button) {
        const order = pendingPayment;
        if (!order || !order.order_id) {
            rememberPending(null);
            return start();
        }

        // Relabelled in place rather than through a confirm dialog: the action
        // is reversible in the only sense that matters here — the goods are
        // still in the cart and placing another order is one click away —
        // and this page uses no alert() or confirm() anywhere else.
        button.disabled = true;
        button.textContent = 'Cancelling…';

        let response, payload;
        try {
            response = await fetch('/api/orders/' + encodeURIComponent(order.order_id) + '/cancel', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            payload = await response.json().catch(() => null);
        } catch (error) {
            console.error('Cancel request failed.', error);
            // Repainted, not showBanner()'d: the notice screens render no
            // #checkout-error element, so a banner here would go nowhere and
            // the customer would watch the button silently re-enable.
            return paint(awaitingHTML(order.reference, 'We could not reach the server to cancel that.'));
        }

        if (!response.ok) {
            // 409 is the interesting one and it is usually GOOD news: the
            // server checked with the gateway and found money against this
            // order, or it moved on while we were asking. Either way the
            // stored handshake is stale, so re-deriving the whole screen from
            // the server beats arguing with the customer about it — and
            // resumeIfPending() will paint the confirmation if it was paid.
            if (response.status === 409) return start();

            return paint(awaitingHTML(
                order.reference,
                (payload && payload.error) || 'We could not cancel that order.'
            ));
        }

        rememberPending(null);
        // Straight back to the form, with the basket intact.
        start();
    }

    function handlePrintOrder(button) {
        if (!button || button.disabled) return;
        let style = document.getElementById('order-print-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'order-print-styles';
            style.textContent = '@media print{body>*:not(#checkout-root){display:none!important}#checkout-root{max-width:none!important;padding:0!important}#order-print,#order-done{display:none!important}}';
            document.head.appendChild(style);
        }
        window.print();
    }

    // The server names the field it rejected in its own vocabulary
    // (address_line, postal_code); the inputs here are prefixed and shortened.
    function fieldAlias(field) {
        const MAP = { address_line: 'address', postal_code: 'postal' };
        return MAP[field] || field;
    }

    // ------------------------------------------------------------------
    // BOOT
    // ------------------------------------------------------------------
    // Bound once, at boot. start() repaints `root` as often as it likes —
    // binding inside the painter would stack a fresh listener on every
    // repaint, and removing one blocked line would then fire start() as many
    // times as the page had been drawn.
    root.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;

        if (target.id === 'checkout-retry') return start();

        // Reopens the SAME Razorpay order. Not start(), which would price a
        // fresh cart and create a second order for goods the customer has
        // already got one open for.
        if (target.id === 'checkout-resume-payment') return startPayment();

        if (target.id === 'checkout-cancel-order') return cancelPendingOrder(target);

        // closest(), not target.id: this button holds an <svg> and a <span>,
        // so a click lands on one of those far more often than on the button
        // itself. (checkout-retry above is bare text, which is why an id test
        // is enough for it.)
        const print = target.closest && target.closest('#checkout-print');
        if (print) return handlePrintOrder(print);

        // "These need a quote" — carry the basket across the navigation.
        //
        // This is a real <a> to another document, so the quote form is reached
        // by a page load and not by opening an overlay here: request-quote-
        // module.js is not loaded on this page, and loading it would mean
        // pulling the store shell onto the one document that carries Razorpay's
        // CSP grant. What that costs is a global — window.srkPendingQuoteItems,
        // which is how the cart drawer and the details overlay hand a selection
        // over in-page, does not survive a navigation.
        //
        // So it goes through sessionStorage instead (storeOverlay.pendingQuote,
        // consumed once on the far side). Without it the customer was told
        // "send it as a quote request", clicked, and landed on an empty form
        // with every product and quantity they had chosen thrown away.
        //
        // The quantities come from the cart rather than from priced.blocked,
        // which carries a product id and a reason and no quantity. The cart is
        // what this page priced in the first place, so it is the same basket
        // by construction — and it is read here rather than at paint time
        // because the customer can still remove a line from the screen behind
        // this button.
        //
        // Not preventDefault: the write is synchronous and the link then does
        // exactly what it says. A failed write (storage disabled) still lands
        // them on the quote form, which is where the href alone used to.
        const quoteLink = target.closest && target.closest('#checkout-to-quote');
        if (quoteLink) {
            try {
                const blockedIds = new Set(
                    (priced && Array.isArray(priced.blocked) ? priced.blocked : [])
                        .map(item => String(item.product_id))
                );
                // A cart line's product id is `line.id` — the same field
                // this page already sends as `product_id` when it prices the
                // basket. There is no `line.product_id` on a cart line.
                const carried = cart.items()
                    .filter(line => !blockedIds.size || blockedIds.has(String(line.id)))
                    .map(line => ({ product_id: line.id, quantity: line.quantity }));

                if (chrome.pendingQuote) chrome.pendingQuote.put(carried);
            } catch (error) {
                // The navigation is the important half and it happens anyway.
            }
            return;
        }

        const remove = target.closest && target.closest('[data-remove]');
        if (remove) {
            cart.remove(remove.getAttribute('data-remove'));
            start();
        }

        const paymentCard = target.closest && target.closest('[data-payment-mode]');
        if (paymentCard) {
            // The submit button is disabled while an order is in flight; these
            // cards are not. Changing how you are paying for an order that is
            // already being placed is not a thing to honour.
            if (placing) return;

            paymentMode = paymentCard.getAttribute('data-payment-mode');

            // Only set on an offline card. Leaving the previous instrument
            // alone when Pay Now is picked is what lets a customer flip to
            // Pay Now and back without losing the offline method they had
            // chosen — and the server ignores it on the online path anyway.
            const picked = paymentCard.getAttribute('data-payment-method');
            if (picked) paymentMethod = picked;
            saveDraft();

            // Only the grid and its note repaint — a full form repaint here
            // would drop whatever the customer had already typed above it.
            const grid = document.getElementById('checkout-payment-methods');
            if (grid) grid.innerHTML = paymentMethodGridHTML();

            const note = document.getElementById('checkout-payment-note');
            if (note) note.innerHTML = paymentNoteHTML();

            // The button is a promise about what the next click does, and the
            // selection just changed what that is.
            refreshSubmitButton();
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.storeCheckout = { reload: start };
})();
