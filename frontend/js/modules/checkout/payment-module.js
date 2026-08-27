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

   So it is a genuine exception — and it is confined the same way the Google map
   is, by map-consent-module.js. The <script> tag is NOT in the served markup.
   It is injected by the first payment attempt. A visitor who opens the checkout
   page and leaves, or who never gets as far as paying, has told Razorpay
   nothing. Before that click nothing leaves this origin.

   The server grants Razorpay's CSP directives on this page only, and works out
   which page that is by reading the HTML for `data-razorpay-checkout` — the
   same read-rather-than-write pattern as the map. See RAZORPAY_PAGES in
   server.js.

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

    // One in-flight load shared by every caller. Without this, a customer who
    // double-clicks Place Order injects the script twice and races two
    // Razorpay globals.
    let scriptPromise = null;

    function loadCheckoutScript() {
        if (window.Razorpay) return Promise.resolve(window.Razorpay);
        if (scriptPromise) return scriptPromise;

        scriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SCRIPT_URL;
            script.async = true;

            script.onload = () => {
                if (window.Razorpay) resolve(window.Razorpay);
                else reject(new Error('Razorpay checkout loaded but did not register.'));
            };

            // A blocked or failed load must not leave the promise pending
            // forever — the caller needs to re-enable its button and say
            // something. Cleared so a later attempt can try again rather than
            // inheriting this failure.
            script.onerror = () => {
                scriptPromise = null;
                reject(new Error('Could not load the payment provider.'));
            };

            document.head.appendChild(script);
        });

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
            Razorpay = await loadCheckoutScript();
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
        // modal stays open on its own retry screen, so this must NOT settle
        // and must not be treated as terminal — see onAttemptFailed above.
        if (typeof instance.on === 'function') {
            instance.on('payment.failed', function (event) {
                const description = event && event.error && event.error.description;
                console.warn('Razorpay reported a failed payment.', event && event.error);
                onAttemptFailed(description || 'That payment did not go through. You can try another method.');
            });
        }

        instance.open();
    }

    window.storePayment = { pay: pay };
})();
