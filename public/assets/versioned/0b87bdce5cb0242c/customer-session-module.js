/**
 * customer-session-module.js
 *
 * Who the visitor is, as far as the storefront is concerned: whether anyone is
 * signed in, what their contact and delivery details are, and how those change.
 *
 * This used to be sample data in localStorage with a seam cut through it. The
 * seam has now been used: every accessor below talks to `/api/auth/*` in
 * backend/server.js, which reads and writes the real `user_profiles` and
 * `shipping_addresses` tables. Nothing above this file changed shape when that
 * happened, which was the point of the seam.
 *
 * Customer sign-in requires an identifier and password. The httpOnly session
 * means this module keeps neither a reusable token nor the password.
 *
 * WHAT IS ON THE SERVER NOW
 * -------------------------
 * The session is an httpOnly cookie (`srk_sid`), so page JS cannot read it and
 * neither can injected script. Every call here sends `credentials: 'include'`;
 * there is no token in localStorage, because a token in localStorage is
 * readable by any XSS.
 *
 * WHY THERE IS STILL A CACHE
 * --------------------------
 * `current()` is synchronous and is called during render, so the profile is
 * held in memory and refreshed around every write. `ready` is the promise for
 * the first read; anything that paints an account state should await it once,
 * or it will paint "signed out" during the round trip on a page load where the
 * visitor is in fact signed in.
 *
 * LOAD ORDER
 * ----------
 * Before my-orders-module.js and profile-icon-loader.js, both of which read it.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.customerSession) return;

    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    let customer = null;        // the cached profile, or null when signed out
    let loaded = false;         // has the first /api/auth/me landed?
    const listeners = [];

    function notify() {
        listeners.forEach(fn => {
            try {
                fn();
            } catch (error) {
                console.error('Customer session listener failed.', error);
            }
        });
    }

    function setCustomer(next) {
        customer = next || null;
        loaded = true;
        notify();
    }

    // ------------------------------------------------------------------
    // TRANSPORT
    // ------------------------------------------------------------------
    // One shape out of every call: { ok: true, ... } or
    // { ok: false, field, error }. `field` is the id suffix the overlay puts
    // the message against, so a server-side validation failure lands on the
    // same input a client-side one would.
    async function call(url, options) {
        let response;

        try {
            response = await fetch(url, Object.assign({
                // The session cookie rides on this and nothing else. Without
                // it every one of these is an anonymous request.
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            }, options || {}));
        } catch (error) {
            console.error('Account request failed.', error);
            return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            return {
                ok: false,
                field: payload && payload.field,
                // So the form can tell a refusal from "there is no such
                // account", which is not a mistake to correct in place but a
                // fork: sign in with something else, or create the account.
                // The overlay offers the choice rather than leaving a red
                // line under a field and nothing to press.
                accountNotFound: !!(payload && payload.account_not_found),
                error: (payload && payload.error) || 'Something went wrong. Try again.'
            };
        }

        return { ok: true, data: payload || {} };
    }

    const postJSON = (url, body) => call(url, { method: 'POST', body: JSON.stringify(body || {}) });

    // ------------------------------------------------------------------
    // FIRST READ
    // ------------------------------------------------------------------
    // /api/auth/me answers 200 with a null customer when nobody is signed in,
    // so a first visit is an ordinary answer rather than an error to report.
    async function refresh() {
        const result = await call('/api/auth/me', { method: 'GET' });

        if (!result.ok) {
            // A server that cannot be reached is not the same as being signed
            // out, but there is nothing else the page can show. Mark it loaded
            // so the overlay stops waiting.
            loaded = true;
            return null;
        }

        setCustomer(result.data.customer);
        return customer;
    }

    const ready = refresh();

    // ------------------------------------------------------------------
    // READERS
    // ------------------------------------------------------------------
    function current() {
        return customer ? Object.assign({}, customer) : null;
    }

    function isSignedIn() {
        return customer !== null;
    }

    // A profile is "set up" once it can address a parcel. The overlay uses
    // this to decide whether an account goes to the address step or straight
    // to the account view — which is also what makes an abandoned signup
    // recoverable: step 01 created a real account, so signing back in lands on
    // step 02 rather than on a page full of blanks.
    //
    // There is no non-customer branch here, and nothing left for one to
    // catch. Such an account never holds a storefront session: the login
    // route refuses the role outright and GET /api/auth/me answers null for
    // any session this application did not open, so the profile here is a
    // customer by construction. The branch that used to sit inside this
    // function existed only to stop one being sent to a "Delivery Address"
    // step meant for a half-finished signup, and it was a symptom of a flow
    // that has since been removed.
    function needsOnboarding() {
        if (!customer) return false;
        return !customer.name || !customer.phone || !customer.address_line || !customer.city;
    }

    // ------------------------------------------------------------------
    // WRITERS
    // ------------------------------------------------------------------
    const MIN_PHONE_DIGITS = 7;
    const MIN_PASSWORD_LENGTH = 8;
    const MAX_PASSWORD_LENGTH = 128;

    const digitsOf = (value) => String(value || '').replace(/[^0-9]/g, '');

    // Checked here as well as on the server, so an obvious mistake is answered
    // instantly instead of after a round trip. The server's copy is the one
    // that counts — this is courtesy, not enforcement.
    function identifierProblem(identifier) {
        const value = String(identifier || '').trim();
        if (!value) return 'Enter your email or phone number.';

        if (value.indexOf('@') !== -1) {
            return EMAIL_PATTERN.test(value.toLowerCase()) ? null : 'Enter a valid email address.';
        }

        return digitsOf(value).length >= MIN_PHONE_DIGITS
            ? null
            : 'Enter a valid phone number, or use your email instead.';
    }

    function passwordProblem(password) {
        if (typeof password !== 'string' || !password) return 'Enter a password.';
        if (password.length < MIN_PASSWORD_LENGTH) return 'Use at least 8 characters.';
        if (password.length > MAX_PASSWORD_LENGTH) return 'Use no more than 128 characters.';
        return null;
    }

    async function signIn(details) {
        const identifier = String(details && details.identifier || '').trim();
        const password = typeof (details && details.password) === 'string' ? details.password : '';

        const problem = identifierProblem(identifier);
        if (problem) return { ok: false, field: 'identifier', error: problem };
        const credentialProblem = passwordProblem(password);
        if (credentialProblem) return { ok: false, field: 'password', error: credentialProblem };

        const result = await postJSON('/api/auth/login', { identifier, password });
        if (!result.ok) return result;

        setCustomer(result.data.customer);
        return { ok: true, customer: current() };
    }

    // Step 01 of signing up: the contact details `user_profiles` requires.
    // The delivery address is step 02 and goes through updateProfile, because
    // it lands in a different table — see migration 011.
    async function signUp(details) {
        const name = String(details && details.name || '').trim();
        const email = String(details && details.email || '').trim().toLowerCase();
        const phone = String(details && details.phone || '').trim();
        const company = String(details && details.company || '').trim();
        const password = typeof (details && details.password) === 'string' ? details.password : '';

        if (!name) return { ok: false, field: 'name', error: 'Enter your name.' };
        if (!email) return { ok: false, field: 'email', error: 'Enter an email address.' };
        if (!EMAIL_PATTERN.test(email)) return { ok: false, field: 'email', error: 'Enter a valid email address.' };
        if (!phone) return { ok: false, field: 'phone', error: 'Enter a phone number.' };
        if (digitsOf(phone).length < MIN_PHONE_DIGITS) {
            return { ok: false, field: 'phone', error: 'Enter a phone number we can reach you on.' };
        }
        const credentialProblem = passwordProblem(password);
        if (credentialProblem) return { ok: false, field: 'password', error: credentialProblem };
        const result = await postJSON('/api/auth/register', { name, email, phone, company, password });
        if (!result.ok) return result;

        setCustomer(result.data.customer);
        return { ok: true, customer: current() };
    }

    async function signOut() {
        const result = await postJSON('/api/auth/logout', {});

        // Cleared locally either way. A failed logout that leaves the page
        // still showing an account is worse than one that signs you out of the
        // UI while the cookie lingers — and the cookie is httpOnly, so this is
        // the only lever the page has.
        setCustomer(null);
        return result.ok ? { ok: true } : result;
    }

    // Takes any subset of the editable fields. The address half is upserted
    // server-side against a one-per-customer index, so this cannot leave
    // somebody with two delivery addresses.
    async function updateProfile(fields) {
        if (!customer) return { ok: false, error: 'You are not signed in.' };

        const EDITABLE = ['name', 'phone', 'company', 'address_line', 'city', 'state', 'postal_code', 'country'];
        const body = {};

        EDITABLE.forEach(key => {
            if (fields && Object.prototype.hasOwnProperty.call(fields, key)) {
                body[key] = String(fields[key] === null || fields[key] === undefined ? '' : fields[key]).trim();
            }
        });

        if (!Object.keys(body).length) return { ok: true, customer: current() };

        const result = await call('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
        if (!result.ok) return result;

        setCustomer(result.data.customer);
        return { ok: true, customer: current() };
    }

    window.customerSession = {
        ready,
        refresh,

        signIn,
        signUp,
        signOut,
        updateProfile,

        current,
        isSignedIn,
        needsOnboarding,
        isLoaded: () => loaded,

        subscribe: (fn) => { if (typeof fn === 'function') listeners.push(fn); },

        EMAIL_PATTERN,
        MIN_PHONE_DIGITS
    };
})();
