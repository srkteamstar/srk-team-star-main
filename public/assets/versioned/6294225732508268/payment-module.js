/* =============================================================================
   payment-module.js — opening Razorpay, and believing only the server
   =============================================================================

   WHAT THIS IS
   ------------
   The browser half of the gateway. It opens Razorpay's modal and reports what
   came back. It decides nothing about money — the confirmation a customer sees
   comes from this site's own server answering POST /api/payments/verify, never
   from Razorpay's callback firing.

   That distinction is the whole design. Razorpay's `handler` runs in this page,
   which means it runs in a place the customer controls: a devtools console can
   call it with any arguments at all. So `handler` here does exactly one thing —
   forwards three strings to the server — and the "Payment received" screen is
   painted only if the server, having asked Razorpay directly over a connection
   this page cannot touch, says so.

   THE SCRIPT LOADS ON THE CLICK THAT NEEDS IT
   -------------------------------------------
   Tailwind, Lenis and the fonts were all vendored so that no external origin is
   a script source on this site. Razorpay cannot be vendored: checkout.js is
   served and updated by Razorpay, and card details being entered inside their
   iframe rather than this origin is what keeps this site out of PCI scope.

   So it is a genuine exception — and it is confined to checkout plus the
   dedicated payment tab by the same per-document CSP scan that grants the
   embedded Google map. The <script> tag is NOT in either served document. It
   is injected by the first payment attempt. A visitor who opens checkout and
   leaves, or who never gets as far as paying, has told Razorpay nothing.
   Before that click nothing leaves this origin.

   The server grants Razorpay's CSP directives only on checkout and its small
   payment-tab host, and discovers both by reading their HTML for
   `data-razorpay-checkout` — the same read-rather-than-write pattern as the
   map. See RAZORPAY_PAGES in security-headers.js.

   NO AMOUNT IS PASSED TO RAZORPAY
   -------------------------------
   Only `order_id`. When an order id is supplied, Razorpay charges the amount
   recorded against that order on its own servers — a figure this page never
   saw and cannot influence. Passing `amount` as well would be worse than
   redundant: if the two ever disagreed, the order would win and the customer
   would be shown one number and charged another.
   ============================================================================= */

(function () {
    'use strict';

    const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

    // The site's own accent, so the modal does not arrive in Razorpay blue.
    const BRAND_COLOUR = '#d4af37';
    const BRAND_NAME = 'SRK Team Star';

    // One in-flight load per browser window. Checkout deliberately opens the
    // gateway in a separate tab so the original checkout page remains in
    // place. A WeakMap keeps the two documents independent without retaining
    // a closed payment tab.
    const scriptPromises = new WeakMap();

    function paymentHostReady(host) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + 10000;

            function check() {
                try {
                    if (host.closed) return reject(new Error('The payment tab was closed.'));
                    if (host.location.pathname === '/store/payment.html' && host.document.readyState !== 'loading') {
                        return resolve();
                    }
                } catch (error) {
                    // The tab is between documents. It will become same-origin
                    // again when the payment host finishes loading.
                }

                if (Date.now() >= deadline) return reject(new Error('The payment tab did not finish loading.'));
                window.setTimeout(check, 25);
            }

            check();
        });
    }

    async function loadCheckoutScript(targetWindow) {
        const host = targetWindow || window;
        if (host.closed) return Promise.reject(new Error('The payment tab was closed.'));
        if (host !== window) await paymentHostReady(host);
        if (host.Razorpay) return Promise.resolve(host.Razorpay);

        const inFlight = scriptPromises.get(host);
        if (inFlight) return inFlight;

        const scriptPromise = new Promise((resolve, reject) => {
            const script = host.document.createElement('script');
            script.src = SCRIPT_URL;
            script.async = true;

            script.onload = () => {
                if (host.Razorpay) resolve(host.Razorpay);
                else reject(new Error('Razorpay checkout loaded but did not register.'));
            };

            // A blocked or failed load must not leave the promise pending
            // forever — the caller needs to re-enable its button and say
            // something. Cleared so a later attempt can try again rather than
            // inheriting this failure.
            script.onerror = () => {
                scriptPromises.delete(host);
                reject(new Error('Could not load the payment provider.'));
            };

            host.document.head.appendChild(script);
        });

        scriptPromises.set(host, scriptPromise);
        return scriptPromise;
    }

    /**
     * Ask the server whether that payment is real.
     *
     * Everything this page knows about the payment is a claim. This is the
     * only place that claim becomes a fact, and the fact is the server's.
     */
    async function confirmWithServer(orderId, response) {
        const reply = await fetch('/api/payments/verify', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: orderId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
            })
        });

        const payload = await reply.json().catch(() => null);
        return { ok: reply.ok, status: reply.status, payload: payload };
    }

    /**
     * Open the modal for an order the server has already written.
     *
     * `order` is the `payment` object from POST /api/checkout — key_id,
     * gateway_order_id, amount_paise, currency — plus our own order_id.
     *
     * Callbacks, all optional:
     *   onPaid(result)          the SERVER confirmed. Safe to clear the cart.
     *   onFailed(message)       terminal: the attempt is over and unpaid.
     *   onAttemptFailed(message) one attempt failed, MODAL IS STILL OPEN.
     *   onDismissed()           the customer closed the modal without paying.
     *
     * onAttemptFailed is separate from onFailed for a reason that is easy to
     * miss: Razorpay's `payment.failed` fires while the modal is still on
     * screen, on its own retry step. Treating it as terminal would paint a
     * "that did not go through" screen on the page *underneath* a modal the
     * customer is still using, and then the retry they are about to make would
     * succeed against a page that has already given up.
     */
    async function pay(options) {
        const settings = options || {};
        const payment = settings.payment || {};
        const contact = settings.contact || {};
        const paymentWindow = settings.paymentWindow && !settings.paymentWindow.closed
            ? settings.paymentWindow
            : window;

        const onPaid = typeof settings.onPaid === 'function' ? settings.onPaid : function () {};
        const onFailed = typeof settings.onFailed === 'function' ? settings.onFailed : function () {};
        const onDismissed = typeof settings.onDismissed === 'function' ? settings.onDismissed : function () {};
        const onAttemptFailed = typeof settings.onAttemptFailed === 'function' ? settings.onAttemptFailed : function () {};

        if (!payment.key_id || !payment.gateway_order_id) {
            onFailed('This order is not set up for online payment.', { settling: false });
            return;
        }

        let Razorpay;
        try {
            Razorpay = await loadCheckoutScript(paymentWindow);
        } catch (error) {
            console.error('Razorpay script failed to load.', error);
            // Nothing was charged: the modal never opened.
            onFailed('Could not reach the payment provider. Check your connection and try again.', { settling: false });
            return;
        }

        // Guards against the modal closing and a callback both firing. Razorpay
        // calls ondismiss when the customer closes it — including, on some
        // flows, right after a successful payment — so without this a paid
        // order could also report "you cancelled".
        let settled = false;

        const instance = new Razorpay({
            key: payment.key_id,
            // No `amount`. See the header — the order id governs the charge.
            order_id: payment.gateway_order_id,
            currency: payment.currency || 'INR',
            name: BRAND_NAME,
            description: settings.reference ? ('Order ' + settings.reference) : 'Order payment',
            prefill: {
                name: contact.name || '',
                email: contact.email || '',
                contact: contact.phone || ''
            },
            notes: settings.reference ? { reference: settings.reference } : {},
            theme: { color: BRAND_COLOUR },

            handler: async function (response) {
                if (settled) return;
                settled = true;

                try {
                    const confirmation = await confirmWithServer(settings.orderId, response);

                    if (confirmation.ok && confirmation.payload && confirmation.payload.paid) {
                        onPaid(confirmation.payload);
                        return;
                    }

                    // 503 means our server could not reach Razorpay to check —
                    // which is emphatically not "you were not charged". The
                    // webhook will settle it, so the customer is told to wait
                    // rather than told to pay again.
                    //
                    // `settling` is a flag rather than something the caller
                    // infers from the wording: a screen that decides whether
                    // money moved by pattern-matching prose breaks silently
                    // the first time the copy is edited.
                    if (confirmation.status === 503) {
                        onFailed(
                            'Your payment went through but we could not confirm it just yet. It will appear in your orders shortly — please do not pay again.',
                            { settling: true }
                        );
                        return;
                    }

                    onFailed(
                        (confirmation.payload && confirmation.payload.error) ||
                        'We could not confirm that payment. Our team will check and get back to you.',
                        { settling: false }
                    );
                } catch (error) {
                    console.error('Payment verification request failed.', error);
                    // Same reasoning as the 503 branch: the request left this
                    // page after Razorpay reported success, so the money may
                    // well have moved and the honest instruction is to wait.
                    onFailed(
                        'Your payment may have gone through, but we could not confirm it. Please check your orders before trying again.',
                        { settling: true }
                    );
                }
            },

            modal: {
                ondismiss: function () {
                    if (settled) return;
                    settled = true;
                    onDismissed();
                },
                // Closing by accident mid-payment is expensive to recover from,
                // so the customer is asked first.
                confirm_close: true,
                escape: false
            }
        });

        // Razorpay reports a failed attempt separately from the handler. The
        // ordinary embedded flow can keep its retry screen open. Checkout's
        // separate-tab flow opts into a terminal failure instead: the payment
        // tab closes and the unchanged checkout form becomes the safe place to
        // try again or choose another method.
        if (typeof instance.on === 'function') {
            instance.on('payment.failed', function (event) {
                const description = event && event.error && event.error.description;
                console.warn('Razorpay reported a failed payment.', event && event.error);
                const message = description || 'That payment did not go through. You can try another method.';
                if (settings.terminalAttemptFailure) {
                    if (settled) return;
                    settled = true;
                    onFailed(message, { settling: false, attemptFailed: true });
                    return;
                }
                onAttemptFailed(message);
            });
        }

        instance.open();
    }

    window.storePayment = { pay: pay };
})();
