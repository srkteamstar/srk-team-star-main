/*
 * modules/checkout/controllers/checkout.controller.js
 * ============================================================================
 *
 *   POST /api/checkout/summary   price the basket for DISPLAY
 *   POST /api/checkout           price it again, and write the order
 *
 * PRICING TWICE IS NOT REDUNDANT. Minutes can pass between the two calls, and
 * the order is written at the price that is real when it is written.
 *
 * THE ORDER OF OPERATIONS IS THE SECURITY MODEL, and step 3 before step 4 is
 * the load-bearing part: the order, its items, the frozen address and the
 * payment row are all written FIRST, in one Postgres function (migration 025's
 * create_store_order, so any exception rolls the lot back), and only then is a
 * Razorpay order created from the amount on the row this server wrote. Money
 * must never be able to move against an order that does not exist yet, and the
 * amount sent to the gateway is read back off our own row rather than taken
 * from a request body.
 *
 * A GUEST CHECKOUT CREATES THE ACCOUNT THE ORDER NEEDS, because orders.user_id
 * is NOT NULL. It requires a password for that new account and refuses to
 * adopt any existing profile: returning customers authenticate through the
 * rate-limited auth door before checking out. A session this application did
 * not open is treated as a guest for the same reason.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const razorpay = require('../../../core/gateways/razorpay');
const { PAYMENTS_ENABLED } = require('../../../core/config/payments');
const { GST_RATE, SHIPPING_FLAT, SHIPPING_FREE_ABOVE } = require('../../../core/config/commercial');
const { sessionScope, sessionProfile, isBlocked, BLOCKED_MESSAGE, roleNameById, roleIdByName } = require('../../../core/security/guards');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong, trimmed } = require('../../../shared/validation');
const { CURRENCY, PAYMENT_STATUS, PAYMENT_METHODS, PAYMENT_MODES } = require('../../../shared/contracts/payment');
const { ORDER_STATUS_AWAITING_PAYMENT, ORDER_STATUS_PLACED } = require('../../../shared/contracts/order-status');
const { orderReference } = require('../../../shared/contracts/order-reference');
const {
    normalizePhone,
    normalizeEmail,
    addressForUser,
    publicProfile,
    startSession,
    passwordProblem,
    hashCustomerPassword
} = require('../../auth/auth.public');
const { priceCheckout } = require('../services/price-checkout.service');
const { summaryLimiter, checkoutLimiter } = require('../infrastructure/checkout-rate-limit');

/** @returns {import('express').Router} */
function checkoutController() {
    const router = express.Router();

    // ---- What will this cost? --------------------------------------------------
    // Public: the checkout page is reachable signed out, and pricing a basket
    // reveals nothing that /api/products/public does not already publish.
    router.post('/api/checkout/summary', summaryLimiter, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const priced = await priceCheckout(req.body && req.body.items);
            if (!priced.ok) return res.status(400).json({ error: priced.error });

            // The page has to know which of the two flows it is in BEFORE the
            // customer submits: with the gateway on, the offline "how will you
            // pay" picker is meaningless and the button says something different.
            // Discovering it from the checkout response would be too late — the
            // form would already have been drawn wrong.
            //
            // Safe to publish: it says a gateway exists, which the payment modal
            // announces anyway, and nothing about keys.
            res.status(200).json({
                lines: priced.lines,
                blocked: priced.blocked,
                totals: priced.totals,
                payments_enabled: PAYMENTS_ENABLED,

                // THE OFFLINE INSTRUMENTS, FROM THE LIST THAT ACTUALLY ENFORCES
                // THEM.
                //
                // This array used to be typed out a second time in
                // checkout-module.js under a comment asking whoever edited one to
                // remember the other. That is not a division of responsibility, it
                // is a standing invitation to drift — and the drift is silent in
                // the expensive direction: a method added to the page but not to
                // the server is offered to the customer, chosen, posted, and
                // quietly rewritten to PAYMENT_METHODS[0] ('Cash on Delivery')
                // when the order is written, with nothing anywhere reporting a
                // problem.
                //
                // It holds a single instrument today — the picker is pay-now
                // versus pay-on-receipt, and this is what the second one means.
                // It is still published as a LIST rather than collapsed into the
                // mode, because the two are different questions: `payment_mode`
                // chooses the flow, this chooses what an offline order settles
                // with, and the day a second offline instrument comes back the
                // page picks it up without a matching edit here.
                //
                // So the *vocabulary* is published from the one copy that
                // validates it. The page still owns how each one looks — a label,
                // a hint, an icon path — because an SVG in an API response is a
                // presentation decision leaking into a contract, and the server
                // has no business holding one. Keys it does not recognise are
                // rendered with a fallback glyph rather than dropped, so adding a
                // method here is enough to make it appear.
                payment_methods: PAYMENT_METHODS
            });
        } catch (error) {
            console.error("Checkout Summary Error:", error);
            res.status(500).json({ error: "Could not price your cart." });
        }
    });

    // ---- Place the order -------------------------------------------------------
    router.post('/api/checkout', checkoutLimiter, async (req, res) => {
        const body = req.body || {};
        const address = body.address || {};

        // WHICH FLOW THIS ORDER TAKES, decided once here and read everywhere below.
        //
        // Both halves have to be true. The customer's choice alone would let a
        // crafted body ask for a gateway that is not configured; PAYMENTS_ENABLED
        // alone is what used to force every order through the gateway and take
        // pay-on-receipt away. `&&` is the whole rule:
        //
        //   gateway off            -> offline, whatever the body says
        //   gateway on, 'offline'  -> offline, no Razorpay order is created
        //   gateway on, 'online'   -> Razorpay
        //
        // Defaulting an unrecognised value to 'online' when the gateway is up is
        // deliberate: it is what the page defaults to, so a body with the field
        // missing is an older client that only knew the gateway flow, and giving
        // it the flow it expects is safer than silently placing an unpaid order it
        // will show as complete.
        const requestedMode = PAYMENT_MODES.includes(trimmed(body.payment_mode))
            ? trimmed(body.payment_mode)
            : 'online';
        const payOnline = PAYMENTS_ENABLED && requestedMode === 'online';

        const addressLine = trimmed(address.address_line);
        const city = trimmed(address.city);
        const state = trimmed(address.state);
        const postal = trimmed(address.postal_code);
        const country = trimmed(address.country) || 'India';

        if (!addressLine) return res.status(400).json({ field: 'address_line', error: "Enter a street address." });
        if (!city) return res.status(400).json({ field: 'city', error: "Enter a city." });
        if (!state) return res.status(400).json({ field: 'state', error: "Enter a state." });
        if (!postal) return res.status(400).json({ field: 'postal_code', error: "Enter a PIN code." });

        try {
            // ---- 1. Price it. Before anything is written, and from the database.
            const priced = await priceCheckout(body.items);
            if (!priced.ok) return res.status(400).json({ error: priced.error });

            // A blocked line is not something to quietly drop: the customer is
            // looking at a total that includes it. Refuse the whole order and name
            // the lines, so the page can strike them out and re-price.
            if (priced.blocked.length) {
                return res.status(409).json({
                    error: "Some items can no longer be ordered online.",
                    blocked: priced.blocked
                });
            }
            if (!priced.lines.length) {
                return res.status(400).json({ error: "There is nothing priced in your cart to order." });
            }

            // ---- 2. Who is this for?
            //
            // A signed-in session wins outright over anything in the body. Trusting
            // a posted email here would let anyone file an order — and an address —
            // against somebody else's account.
            //
            // A SESSION THIS APPLICATION DID NOT OPEN IS NOT A SIGNED-IN
            // CUSTOMER HERE, IT IS A GUEST.
            // This route reads the session directly rather than sitting behind
            // requireCustomer (it has to serve guests), so it does not get that
            // middleware's scope check for free and has to make it itself.
            // Without it, a session carrying any other scope would file the
            // order against whatever row it points at — an order in a name no
            // storefront surface will ever show, since /api/auth/me answers
            // null for such a session. Falling through to the guest path is
            // correct and is not a way in: the adoption guard below refuses a
            // non-customer profile, so typing that account's own email is
            // answered, not obeyed.
            let profile = sessionScope(req) !== 'customer' ? null : await sessionProfile(req);
            let startedSession = false;

            // This route reads the session itself rather than sitting behind
            // requireCustomer (it has to serve guests), so the suspension check
            // requireCustomer performs has to be repeated here or a blocked
            // customer with a live cookie could still place orders.
            if (isBlocked(profile)) {
                return res.status(403).json({ error: BLOCKED_MESSAGE });
            }

            if (!profile) {
                const name = trimmed(body.contact && body.contact.name);
                const email = normalizeEmail(body.contact && body.contact.email);
                const phone = trimmed(body.contact && body.contact.phone);
                const company = trimmed(body.contact && body.contact.company);
                const digits = normalizePhone(phone);
                const password = body.contact && body.contact.password;

                if (!name) return res.status(400).json({ field: 'name', error: "Enter your name." });
                if (!email || !EMAIL_PATTERN.test(email)) {
                    return res.status(400).json({ field: 'email', error: "Enter a valid email address." });
                }
                if (digits.length < 7) {
                    return res.status(400).json({ field: 'phone', error: "Enter a phone number we can reach you on." });
                }
                const passwordError = passwordProblem(password);
                if (passwordError) return res.status(400).json({ field: 'password', error: passwordError });

                // orders.user_id is NOT NULL, so there is no such thing as an
                // order with nobody attached. A guest checkout therefore creates
                // the account it needs — which is also the only way the customer
                // can be shown this order again afterwards.
                const [byEmail, byPhone] = await Promise.all([
                    supabase.from('user_profiles').select('*').eq('email', email).maybeSingle(),
                    supabase.from('user_profiles').select('*').eq('phone_normalized', digits).maybeSingle()
                ]);
                if (byEmail.error) throw byEmail.error;
                if (byPhone.error) throw byPhone.error;

                profile = byEmail.data || byPhone.data || null;

                // CHECKOUT IS NOT A SECOND PASSWORD VERIFIER. If this contact
                // block belongs to an existing profile, the customer must use
                // POST /api/auth/login first. That keeps all password guessing
                // behind authLimiter and prevents checkoutLimiter from becoming
                // a second attempt budget against the same credential.
                if (profile) {
                    const matchedRole = await roleNameById(profile.role_id);
                    if (matchedRole && matchedRole !== 'customer') {
                        return res.status(409).json({
                            field: 'email',
                            error: "That account cannot check out as a guest. Sign in first, then place the order."
                        });
                    }

                    // Same reasoning one level down: adopting is a session
                    // grant, and a suspended account must not get one through
                    // the form that asks for the least.
                    if (isBlocked(profile)) {
                        return res.status(403).json({ field: 'email', error: BLOCKED_MESSAGE });
                    }

                    return res.status(409).json({
                        field: byEmail.data ? 'email' : 'phone',
                        error: "That account already exists. Sign in with its password before checking out."
                    });
                }

                const row = {
                    full_name: name,
                    email: email,
                    phone_number: phone,
                    phone_normalized: digits,
                    company: company || null,
                    password_hash: await hashCustomerPassword(password)
                };
                const customerRole = await roleIdByName('customer');
                if (customerRole !== null) row.role_id = customerRole;

                const created = await supabase.from('user_profiles').insert([row]).select().single();
                if (created.error) throw created.error;
                profile = created.data;

                await startSession(req, profile.id);
                startedSession = true;
            }

            // ---- 3. Keep the saved address current.
            //
            // Best-effort on purpose. The order's own frozen copy is written below
            // and is what a parcel follows; failing to update the customer's
            // convenience copy must not lose an order that is otherwise good.
            //
            // Only a signed-in customer or a newly created password account can
            // reach this write. An existing profile submitted by a guest was
            // refused above, so public contact fields cannot rewrite its address.
            try {
                const existing = await addressForUser(profile.id);
                const saved = {
                    user_id: profile.id,
                    full_address: addressLine, city: city, state: state,
                    country: country, zip_code: postal
                };
                if (existing) {
                    saved.updated_at = new Date().toISOString();
                    await supabase.from('shipping_addresses').update(saved).eq('id', existing.id);
                } else {
                    await supabase.from('shipping_addresses').insert([saved]);
                }
            } catch (addressError) {
                console.error("Saved-address update failed (order continues):", addressError);
            }

            // ---- 4. Write the complete order atomically.
            // Migration 025 owns the database transaction. If any item, address or
            // payment insert fails, PostgreSQL rolls the header back as well.
            const paymentMethod = PAYMENT_METHODS.includes(trimmed(body.payment_method))
                ? trimmed(body.payment_method)
                : PAYMENT_METHODS[0];
            const amountPaise = razorpay.toPaise(priced.totals.total);
            if (amountPaise === null || amountPaise <= 0) {
                throw new Error(`Refusing to write a payment row for an unrepresentable total: ${priced.totals.total}`);
            }

            const created = await supabase.rpc('create_store_order', {
                p_user_id: profile.id,
                p_order: {
                    amount: priced.totals.subtotal,
                    shipping_amount: priced.totals.shipping,
                    tax_amount: priced.totals.tax,
                    net_amount: priced.totals.total,
                    status: payOnline ? ORDER_STATUS_AWAITING_PAYMENT : ORDER_STATUS_PLACED
                },
                p_items: priced.lines.map(line => ({
                    product_id: line.product_id,
                    product_name: line.product_name,
                    price: line.unit_price,
                    quantity: line.quantity,
                    total_amount: line.line_total
                })),
                p_shipping: {
                    full_address: addressLine, city, state, country, zip_code: postal
                },
                p_payment: {
                    gateway: payOnline ? 'razorpay' : 'offline',
                    payment_method: payOnline ? null : paymentMethod,
                    amount: priced.totals.total,
                    amount_paise: amountPaise,
                    currency: CURRENCY,
                    status: payOnline ? PAYMENT_STATUS.created : PAYMENT_STATUS.pending
                }
            });
            if (created.error) throw created.error;
            const atomic = Array.isArray(created.data) ? created.data[0] : created.data;
            const order = atomic && atomic.order;
            const paymentRow = atomic && atomic.payment;
            if (!order || !paymentRow) throw new Error('Atomic checkout returned an incomplete result.');

            const reference = orderReference(order);

            // ---- 5. Ask Razorpay for an order to pay against.
            //
            // Last, deliberately. Everything above is durable, so the amount sent
            // here is read back off the row this server just wrote rather than
            // taken from anything the browser said — which is the whole reason
            // the writes come first.
            //
            // Nothing but ids goes back to the client. `amount_paise` is included
            // so the page can show what it is about to charge, but Razorpay is
            // opened with the order id ALONE (see payment-module.js): when an
            // order id is supplied the gateway takes the amount from its own
            // record of it, so a tampered figure here changes the display and not
            // the charge.
            let payment = null;

            // payOnline, so a Cash on Delivery order never touches Razorpay at
            // all: no gateway order is created, `payment` stays null in the
            // response, and the page takes its offline branch and shows the
            // confirmation instead of opening a modal.
            if (payOnline) {
                try {
                    const gatewayOrder = await razorpay.createOrder({
                        amountPaise: paymentRow.amount_paise,
                        currency: CURRENCY,
                        receipt: reference,
                        // Notes come back to the browser in Razorpay's own
                        // response, so this carries an internal id and nothing
                        // about the customer.
                        notes: { order_id: String(order.id), reference: reference }
                    });

                    const linked = await supabase
                        .from('payments')
                        .update({ gateway_order_id: gatewayOrder.id })
                        .eq('id', paymentRow.id);
                    if (linked.error) throw linked.error;

                    payment = {
                        key_id: razorpay.publicKeyId(),
                        gateway_order_id: gatewayOrder.id,
                        amount_paise: paymentRow.amount_paise,
                        currency: CURRENCY
                    };
                } catch (gatewayError) {
                    // The order exists but cannot be paid for. Cancelling it is
                    // the honest outcome: leaving a 'Pending Payment' row that no
                    // customer can ever complete is an order that looks live on
                    // every report and is not.
                    console.error("Razorpay order creation failed — cancelling order", order.id, gatewayError);
                    await supabase.from('orders').update({ status: 'Cancelled' }).eq('id', order.id);
                    await supabase.from('payments').update({ status: PAYMENT_STATUS.failed }).eq('id', paymentRow.id);

                    return res.status(502).json({
                        error: "We could not reach the payment provider, so your order was not placed. Nothing has been charged — please try again."
                    });
                }
            }

            res.status(201).json({
                reference: reference,
                order_id: order.id,
                totals: priced.totals,
                signed_in: startedSession || undefined,
                customer: await publicProfile(profile),
                // Absent entirely when the gateway is off, so a client built
                // against the offline flow sees exactly the response it always did.
                payment: payment || undefined
            });
        } catch (error) {
            console.error("Checkout Error:", error);
            if (error && error.code === '23505') {
                return res.status(409).json({ error: "That looks like a duplicate submission. Check your orders before trying again." });
            }
            res.status(500).json({ error: "Could not place your order." });
        }
    });

    return router;
}

module.exports = { checkoutController };
