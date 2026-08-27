/**
 * profile-icon-loader.js
 *
 * The account overlay behind the store header's profile icon: signing in,
 * signing up, filling in delivery details, reading them back, editing them, and
 * seeing what you have ordered.
 *
 * WHAT THIS REPLACED
 * ------------------
 * Three hardcoded HTML templates and a `let currentMode`. Typing any email at
 * all and pressing Sign in swapped in a panel that said "Hello, Amit" — the
 * same fictional person every time, with no credential check, no validation, no
 * request, and nothing kept when the modal closed. "Edit Details" and the
 * onboarding form's "Save Details & Continue" were both buttons with no
 * listener anywhere in the repository.
 *
 * The states are the same four; everything under them is different. The data
 * now comes from the real `/api/auth/*` routes through
 * customer-session-module.js; customer access is identifier-based.
 *
 * WHY THE CENTRED MODAL IS GONE
 * -----------------------------
 * The old overlay was a 400px card floating on a dimmed page — fine for one
 * email field, wrong for an account that now holds contact details, a delivery
 * address and an order history. Rather than run two shapes on one page, this
 * adopts the full-bleed takeover request-quote-module.js established: same
 * lifecycle, same focus trap, same Escape rule, same numbered sections and
 * sticky footer, all from store-overlay-shared-module.js. Signing in and asking
 * for a quote now feel like two doors into one building.
 *
 * Every state renders into the one scrolling body under a fixed header, the way
 * the quote overlay swaps loading for the form and the form for its
 * confirmation. That is what keeps the trap, the header and the Escape handler
 * from having to be rebuilt per state.
 *
 * THE PROFILE BUTTON IS NOT A .nav-btn
 * ------------------------------------
 * It lives in the search row, not the sidebar, so it never triggers store.html's
 * inline active-state script and needs none of the gold-state capture and
 * restore request-quote-module.js does. It is also not a view, so
 * view-state-restore-module.js has nothing to save for it.
 *
 * LOAD ORDER
 * ----------
 * After store-overlay-shared-module.js, customer-session-module.js,
 * my-orders-module.js and price-format-module.js. Before
 * view-state-restore-module.js, which must stay last on the page.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.storeAccount) return;

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('profile-icon-loader.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const account = window.customerSession;
    if (!account) {
        console.error('profile-icon-loader.js needs customer-session-module.js loaded first.');
        return;
    }

    const {
        escapeHtml,
        PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, EYEBROW_CLASSES, SHELL,
        CHECK_ICON,
        sectionHeading, textFieldHTML, textAreaHTML, centredMessageHTML, bannerHTML,
        fieldError, clearErrorsIn, enhance
    } = chrome;

    // The overlay handle from store-overlay-shared-module.js while it is open,
    // otherwise null. Its presence is what "the account overlay is open" means.
    let handle = null;

    function body() {
        return handle ? handle.body : null;
    }

    // ------------------------------------------------------------------
    // MARKUP — shared parts
    // ------------------------------------------------------------------
    function footerHTML(options) {
        return [
            '<div class="sticky bottom-0 z-10 bg-white border-t border-[#12170f]/10">',
            '    <div class="' + SHELL + ' py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">',
            '        <p class="text-xs text-[#1f271b]/50">' + (options.note || 'Fields marked <span class="text-[#d4af37]">*</span> are required.') + '</p>',
            '        <button type="submit" id="' + options.id + '" class="' + PRIMARY_BUTTON_CLASSES + ' w-full sm:w-auto">' + escapeHtml(options.label) + '</button>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    function switchLineHTML(prompt, label, id) {
        return [
            '<p class="text-sm text-[#1f271b]/60 mt-8 text-center">',
            '    ' + escapeHtml(prompt) + ' ',
            '    <button type="button" id="' + id + '" class="font-bold text-[#d4af37] hover:underline">' + escapeHtml(label) + '</button>',
            '</p>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // MARKUP — the register stepper
    // ------------------------------------------------------------------
    // Signing up is two screens: the contact details user_profiles requires,
    // then the delivery address, which is a row in a different table
    // (shipping_addresses — see migration 011). The split is not decoration:
    // step 01 is exactly one table's row and step 02 is exactly the other's,
    // which is also why step 01 commits on its own.
    //
    // There is deliberately no Back on step 02. Step 01 has already created
    // the account by the time it is shown, so "back" would either re-register
    // an email that now exists or quietly edit a record while calling itself
    // a signup. Abandoning step 02 is safe and recoverable instead: it leaves
    // a real account with no address, and signing in again lands right back
    // here — that is what needsOnboarding() has always meant.
    const REGISTER_STEPS = ['Contact Information', 'Delivery Address'];

    function safeReturnDestination() {
        const value = new URLSearchParams(window.location.search).get('returnTo');
        if (!value || !value.startsWith('/') || value.startsWith('//')) return '';
        try {
            const url = new URL(value, window.location.origin);
            return url.origin === window.location.origin ? url.pathname + url.search + url.hash : '';
        } catch (_) {
            return '';
        }
    }

    function finishAuthentication() {
        const destination = safeReturnDestination();
        if (destination) window.location.assign(destination);
        else showAccount();
    }

    function stepperHTML(activeIndex) {
        const cells = REGISTER_STEPS.map((label, index) => {
            const on = index === activeIndex;
            const done = index < activeIndex;

            const dot = on
                ? 'bg-[#d4af37] text-white'
                : done
                    ? 'bg-[#12170f] text-white'
                    : 'bg-[#12170f]/[0.07] text-[#1f271b]/40';

            return [
                '<li class="flex items-center gap-2.5">',
                '    <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ' + dot + '">' +
                     (done ? '&#10003;' : '0' + (index + 1)) + '</span>',
                '    <span class="text-[11px] font-bold uppercase tracking-wider ' +
                     (on ? 'text-[#12170f]' : 'text-[#1f271b]/40') + '">' + escapeHtml(label) + '</span>',
                '</li>'
            ].join('\n');
        });

        return '<ol class="flex flex-wrap items-center gap-x-6 gap-y-3 mb-8 pb-6 border-b border-[#12170f]/10">' +
            cells.join('\n') + '</ol>';
    }

    // ------------------------------------------------------------------
    // STATE — sign in
    // ------------------------------------------------------------------
    // Customer access is identifier-only.
    function signInHTML() {
        return [
            '<form autocomplete="srk-no-autofill" id="account-form" novalidate class="flex flex-col min-h-full">',
            '    <div class="' + SHELL + ' py-10 flex-1 max-w-xl">',
            '        <section class="mb-4">',
            '            ' + sectionHeading('01', 'Sign In', 'Use the email or phone number on your account'),
            '            <div class="grid grid-cols-1 gap-5">',
            '                ' + textFieldHTML({ id: 'account-identifier', label: 'Email or Phone Number', placeholder: 'you@business.com or +91 98765 43210', required: true }),
            '            </div>',
            '            ' + bannerHTML('account-form-error'),
            '            ' + switchLineHTML("Don't have an account?", 'Create one', 'account-switch'),
            '        </section>',
            '    </div>',
            '    ' + footerHTML({ id: 'account-submit', label: 'Sign In', note: 'Use the email or phone number registered to the account.' }),
            '</form>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // STATE — register, step 01 of 02
    // ------------------------------------------------------------------
    // `prefill` carries whatever was typed into the sign-in field across
    // from the "no such account" dialog — into the email box or the phone
    // box, whichever it looks like. Retyping an address you have just typed,
    // to be told again that it is not registered, is the sort of small
    // insult that makes people leave.
    function signUpHTML(prefill) {
        const given = prefill || {};

        return [
            '<form autocomplete="srk-no-autofill" id="account-form" novalidate class="flex flex-col min-h-full">',
            '    <div class="' + SHELL + ' py-10 flex-1 max-w-xl">',
            '        ' + stepperHTML(0),
            '        <section class="mb-4">',
            '            ' + sectionHeading('01', 'Contact Information', 'How we reach you about an order'),
            '            <div class="grid grid-cols-1 gap-5">',
            '                ' + textFieldHTML({ id: 'account-name', label: 'Full Name', placeholder: 'Your name', required: true }),
            '                ' + textFieldHTML({ id: 'account-email', label: 'Email Address', type: 'email', placeholder: 'you@business.com', required: true, value: given.email || '' }),
            '                ' + textFieldHTML({ id: 'account-phone', label: 'Phone Number', type: 'tel', placeholder: '+91 98765 43210', required: true, value: given.phone || '' }),
            '                ' + textFieldHTML({ id: 'account-company', label: 'Business Name', placeholder: 'Optional' }),
            '            </div>',
            '            ' + bannerHTML('account-form-error'),
            '            ' + switchLineHTML('Already have an account?', 'Sign in', 'account-switch'),
            '        </section>',
            '    </div>',
            '    ' + footerHTML({ id: 'account-submit', label: 'Continue' }),
            '</form>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // STATE — register, step 02 of 02
    // ------------------------------------------------------------------
    // The delivery address, asked for once because an order cannot be sent
    // without it. Editable later from the account view; this is the one time
    // it is the whole screen.
    //
    // The contact block reappears here only when something is actually
    // missing. Every path that creates a profile — this flow, and guest
    // checkout — collects a name and a phone, so normally it does not; but
    // needsOnboarding() also fires on a missing name, and a step that cannot
    // fix what sent you to it would be a loop.
    function onboardingHTML(customer) {
        const needsContact = !customer.name || !customer.phone;
        let n = 0;
        const next = () => '0' + (++n);

        return [
            '<form autocomplete="srk-no-autofill" id="account-form" novalidate class="flex flex-col min-h-full">',
            '    <div class="' + SHELL + ' py-10 flex-1">',
            '        ' + stepperHTML(1),
            needsContact
                ? [
                    '        <section class="mb-8">',
                    '            ' + sectionHeading(next(), 'Contact Information', 'So we can reach you'),
                    '            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
                    '                ' + textFieldHTML({ id: 'account-name', label: 'Full Name', placeholder: 'Your name', required: true, value: customer.name }),
                    '                ' + textFieldHTML({ id: 'account-phone', label: 'Phone Number', type: 'tel', placeholder: '+91 98765 43210', required: true, value: customer.phone }),
                    '            </div>',
                    '        </section>'
                  ].join('\n')
                : '',
            '        ' + addressSectionHTML(customer, next()),
            '        ' + bannerHTML('account-form-error'),
            '    </div>',
            '    ' + footerHTML({ id: 'account-submit', label: 'Save & Finish' }),
            '</form>'
        ].filter(line => line !== '').join('\n');
    }

    // Shared by onboarding and the edit form, so the two can never ask for the
    // address in different words or a different order.
    function addressSectionHTML(customer, number) {
        return [
            '<section class="mb-8">',
            '    ' + sectionHeading(number, 'Delivery Address'),
            '    <div class="grid grid-cols-1 gap-5">',
            '        ' + textAreaHTML({ id: 'account-address', label: 'Street Address', placeholder: 'Building, street, area', required: true, rows: 2, value: customer.address_line }),
            '        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
            '            ' + textFieldHTML({ id: 'account-city', label: 'City', placeholder: 'Rajkot', required: true, value: customer.city }),
            '            ' + textFieldHTML({ id: 'account-state', label: 'State', placeholder: 'Gujarat', required: true, value: customer.state }),
            '            ' + textFieldHTML({ id: 'account-postal', label: 'PIN Code', placeholder: '360002', required: true, value: customer.postal_code }),
            '            ' + textFieldHTML({ id: 'account-country', label: 'Country', placeholder: 'India', value: customer.country || 'India' }),
            '        </div>',
            '    </div>',
            '</section>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // STATE — account
    // ------------------------------------------------------------------
    // The grid token is a fixed label column against a
    // flexible value column, labels as small caps. Reading your own details and
    // reading a customer's details in the back office should look like the same
    // record.
    function detailRow(label, value, emptyText) {
        const filled = value && String(value).trim();

        return [
            '<div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider pt-0.5">' + escapeHtml(label) + '</div>',
            '<div class="text-[#12170f] font-bold">' +
                (filled
                    ? escapeHtml(value)
                    : '<span class="text-[#1f271b]/40 font-medium italic">' + escapeHtml(emptyText || 'Not added yet') + '</span>') +
            '</div>'
        ].join('\n');
    }

    function addressLines(customer) {
        const region = [customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ');
        return [customer.address_line, region, customer.country].filter(Boolean).join('\n');
    }

    function accountHTML(customer) {
        const greeting = customer.name ? customer.name.split(' ')[0] : 'there';

        return [
            '<div class="' + SHELL + ' py-10">',
            '    <div class="mb-10">',
            '        <span class="' + EYEBROW_CLASSES + '">Signed in as ' + escapeHtml(customer.email) + '</span>',
            '        <h3 class="text-2xl md:text-3xl font-bold tracking-tight text-[#12170f] mt-2">Hello, ' + escapeHtml(greeting) + '</h3>',
            '    </div>',

            '    <section class="mb-12">',
            '        ' + sectionHeading('01', 'Profile Details'),
            '        <div class="grid grid-cols-[110px_1fr] gap-y-4 text-sm">',
            '            ' + detailRow('Name', customer.name),
            '            ' + detailRow('Email', customer.email),
            '            ' + detailRow('Phone', customer.phone),
            '            ' + detailRow('Business', customer.company, 'Not added'),
            '        </div>',
            '        <div class="mt-6 pt-6 border-t border-[#12170f]/10">',
            '            <div class="text-[#1f271b]/50 font-bold uppercase text-[10px] tracking-wider mb-2">Delivery Address</div>',
            '            <p class="text-sm text-[#1f271b]/80 leading-relaxed font-semibold bg-white p-5 rounded-sm border border-[#12170f]/10 whitespace-pre-wrap">' +
                     (addressLines(customer)
                         ? escapeHtml(addressLines(customer))
                         : '<span class="text-[#1f271b]/40 font-medium italic">No delivery address yet.</span>') +
            '</p>',
            '        </div>',
            '        <div class="mt-6">',
            '            <button type="button" id="account-edit" class="' + SECONDARY_BUTTON_CLASSES + '">Edit Details</button>',
            '        </div>',
            '    </section>',

            '    <section class="mb-12">',
            '        ' + sectionHeading('02', 'My Orders'),
            '        <div id="account-orders"></div>',
            '    </section>',

            '    <div class="pt-6 border-t border-[#12170f]/10">',
            '        <button type="button" id="account-signout" class="text-sm font-bold text-[#1f271b]/50 hover:text-red-600 transition-colors">Sign out</button>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // STATE — edit
    // ------------------------------------------------------------------
    function editHTML(customer) {
        return [
            '<form autocomplete="srk-no-autofill" id="account-form" novalidate class="flex flex-col min-h-full">',
            '    <div class="' + SHELL + ' py-10 flex-1">',
            '        <section class="mb-8">',
            '            ' + sectionHeading('01', 'Profile Details'),
            '            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
            '                ' + textFieldHTML({ id: 'account-name', label: 'Full Name', placeholder: 'Your name', required: true, value: customer.name }),
            '                ' + textFieldHTML({ id: 'account-phone', label: 'Phone Number', type: 'tel', placeholder: '+91 98765 43210', required: true, value: customer.phone }),
            '                ' + textFieldHTML({ id: 'account-company', label: 'Business Name', placeholder: 'Optional', value: customer.company }),
            '            </div>',
            // The email is the account's key and cannot be edited here — a real
            // build would make changing it a verified flow of its own, and a
            // field that silently refuses to save is worse than no field.
            '            <p class="text-xs text-[#1f271b]/50 mt-4">Signed in as <span class="font-bold text-[#1f271b]/70">' + escapeHtml(customer.email) + '</span>. Contact us to change the email on your account.</p>',
            '        </section>',
            '        ' + addressSectionHTML(customer, '02'),
            '        ' + bannerHTML('account-form-error'),
            '    </div>',
            '    <div class="sticky bottom-0 z-10 bg-white border-t border-[#12170f]/10">',
            '        <div class="' + SHELL + ' py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">',
            '            <button type="button" id="account-cancel" class="' + SECONDARY_BUTTON_CLASSES + ' w-full sm:w-auto">Cancel</button>',
            '            <button type="submit" id="account-submit" class="' + PRIMARY_BUTTON_CLASSES + ' w-full sm:w-auto">Save Changes</button>',
            '        </div>',
            '    </div>',
            '</form>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // STATE — signed out
    // ------------------------------------------------------------------
    function signedOutHTML() {
        return centredMessageHTML([
            '<div class="w-14 h-14 mx-auto mb-6 rounded-full bg-[#d4af37]/10 flex items-center justify-center text-[#d4af37]">',
            '    ' + CHECK_ICON,
            '</div>',
            '<h3 class="text-2xl font-bold tracking-tight text-[#12170f] mb-3">Signed out</h3>',
            '<p class="text-sm text-[#1f271b]/60 max-w-md mx-auto mb-8">Your cart is still here when you come back.</p>',
            '<div class="flex items-center justify-center gap-3">',
            '    <button type="button" id="account-signin-again" class="' + PRIMARY_BUTTON_CLASSES + '">Sign In</button>',
            '    <button type="button" id="account-done" class="' + SECONDARY_BUTTON_CLASSES + '">Back to Store</button>',
            '</div>'
        ].join('\n'));
    }

    // ------------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------------
    // Deliberately not the browser's: the forms are `novalidate` so errors are
    // shown inline in the site's own voice rather than in a native bubble.
    // Every entry is skipped when its field is not on screen, which is what
    // lets one validator serve both the address-only step and the full edit
    // form.
    const PROFILE_REQUIRED = [
        { id: 'account-name', message: 'Enter your name.' },
        { id: 'account-phone', message: 'Enter a phone number we can reach you on.' },
        { id: 'account-address', message: 'Enter a street address.' },
        { id: 'account-city', message: 'Enter a city.' },
        { id: 'account-state', message: 'Enter a state.' },
        { id: 'account-postal', message: 'Enter a PIN code.' }
    ];

    // Only the fields actually on screen. This matters more than it looks:
    // step 02 renders no company input, and a blanket read would have sent
    // company: '' and wiped a business name the visitor had just typed on
    // step 01. PATCH /api/auth/me updates exactly the keys it is given, so
    // absent means untouched.
    const PROFILE_FIELDS = {
        name: 'account-name',
        phone: 'account-phone',
        company: 'account-company',
        address_line: 'account-address',
        city: 'account-city',
        state: 'account-state',
        postal_code: 'account-postal',
        country: 'account-country'
    };

    function readProfileForm() {
        const values = {};

        Object.keys(PROFILE_FIELDS).forEach(key => {
            const field = document.getElementById(PROFILE_FIELDS[key]);
            if (field) values[key] = field.value.trim();
        });

        return values;
    }

    function validateProfile() {
        let firstBad = null;

        PROFILE_REQUIRED.forEach(entry => {
            const field = document.getElementById(entry.id);
            if (!field || field.value.trim()) return;

            fieldError(field, entry.message);
            if (!firstBad) firstBad = field;
        });

        return firstBad;
    }

    function showBanner(message) {
        const banner = document.getElementById('account-form-error');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.remove('hidden');
    }

    function setBusy(busy, label) {
        const button = document.getElementById('account-submit');
        if (!button) return;

        button.disabled = busy;
        if (label) button.textContent = label;
    }

    // ------------------------------------------------------------------
    // VIEWS
    // ------------------------------------------------------------------
    function paint(html) {
        const scroll = body();
        if (!scroll) return null;

        scroll.innerHTML = html;
        scroll.scrollTop = 0;
        enhance(scroll);

        return scroll;
    }

    // Clearing an error as soon as the visitor starts fixing it, rather than
    // waiting for the next submit, is what the quote form does and what makes
    // inline errors feel like help instead of scolding.
    function wireErrorClearing(form) {
        form.addEventListener('input', (event) => {
            const field = event.target;
            if (field && field.classList && field.classList.contains('border-red-500')) {
                chrome.clearFieldError(field);
            }
        });
    }

    function showSignIn() {
        const scroll = paint(signInHTML());
        if (!scroll) return;

        const form = scroll.querySelector('#account-form');
        wireErrorClearing(form);

        form.addEventListener('submit', onSignIn);
        scroll.querySelector('#account-switch').addEventListener('click', () => showSignUp());

        focusFirst(scroll);
    }

    function showSignUp(prefill) {
        const scroll = paint(signUpHTML(prefill));
        if (!scroll) return;

        const form = scroll.querySelector('#account-form');
        wireErrorClearing(form);

        form.addEventListener('submit', onSignUp);
        scroll.querySelector('#account-switch').addEventListener('click', showSignIn);

        focusFirst(scroll);
    }

    function showOnboarding() {
        const customer = account.current();
        if (!customer) return showSignIn();

        const scroll = paint(onboardingHTML(customer));
        if (!scroll) return;

        const form = scroll.querySelector('#account-form');
        wireErrorClearing(form);
        form.addEventListener('submit', (event) => onSaveProfile(event, finishAuthentication));

        focusFirst(scroll);
    }

    function showAccount() {
        const customer = account.current();
        if (!customer) return showSignIn();

        const scroll = paint(accountHTML(customer));
        if (!scroll) return;

        scroll.querySelector('#account-edit').addEventListener('click', showEdit);
        scroll.querySelector('#account-signout').addEventListener('click', onSignOut);

        // Mounted rather than inlined, so the order history stays one module's
        // problem and this file never learns the shape of an order.
        if (window.myOrders) {
            window.myOrders.renderPanel(scroll.querySelector('#account-orders'));
        }
    }

    function showEdit() {
        const customer = account.current();
        if (!customer) return showSignIn();

        const scroll = paint(editHTML(customer));
        if (!scroll) return;

        const form = scroll.querySelector('#account-form');
        wireErrorClearing(form);
        form.addEventListener('submit', (event) => onSaveProfile(event, showAccount));
        scroll.querySelector('#account-cancel').addEventListener('click', showAccount);

        focusFirst(scroll);
    }

    function showSignedOut() {
        const scroll = paint(signedOutHTML());
        if (!scroll) return;

        scroll.querySelector('#account-signin-again').addEventListener('click', showSignIn);

        const done = scroll.querySelector('#account-done');
        done.addEventListener('click', close);
        done.focus({ preventScroll: true });
    }

    function focusFirst(scroll) {
        const field = scroll.querySelector('input, textarea');
        if (field) field.focus({ preventScroll: true });
    }

    // ------------------------------------------------------------------
    // THE "NO SUCH ACCOUNT" DIALOG
    // ------------------------------------------------------------------
    // Typing an email that has never been registered is not a mistake to
    // correct in place — it is a fork. Either the identifier is wrong (a
    // different address, a phone number we do not hold), or there is genuinely
    // no account yet. A red line under the field answers neither, so this
    // asks, says why it is asking, and offers both roads.
    //
    // It is a real layer over the form rather than another full-screen state,
    // for one specific reason: the identifier the visitor typed stays visible
    // behind it. Half of "did I type that right?" is being able to look.
    //
    // THE LAYER ITSELF NOW LIVES IN store-overlay-shared-module.js
    // ------------------------------------------------------------
    // It was written here, and it was extracted the moment a second surface
    // needed one — cart-module.js has to ask which of two carts to keep when
    // somebody signs in holding both. That is the same move
    // product-section-shared-module.js made for the card and
    // store-overlay-shared-module.js made for the overlay itself, and the
    // notes that made this thing correct (the window-not-document keydown,
    // the cancelled Tab, one dialog at a time) went with it rather than
    // being left behind on a copy.
    //
    // What stays here is the two decisions that are this surface's own:
    //
    //   * `host` is the account overlay's node, so the layer is `absolute`
    //     inside it and dims only this surface. The identifier the visitor
    //     typed stays visible behind it — half of "did I type that right?"
    //     is being able to look.
    //   * No dialog without an overlay to put it in. `openChoiceDialog`
    //     would happily mount on <body>; that is right for the cart and
    //     wrong here, where the question is about the form underneath.
    function openChoiceDialog(options) {
        const overlay = handle && handle.node;
        if (!overlay) return null;

        return chrome.openChoiceDialog(Object.assign({
            host: overlay,
            idPrefix: 'account-dialog'
        }, options));
    }

    // The identifier goes into whichever signup field it is: an email into the
    // email box, anything else into the phone box. The same test the server
    // uses (an "@" anywhere), so the two cannot disagree about what was typed.
    function prefillFrom(identifier) {
        const value = String(identifier || '').trim();
        return value.indexOf('@') !== -1 ? { email: value } : { phone: value };
    }

    function showNoAccountDialog(identifier) {
        const typed = '<span class="font-bold text-[#12170f]">' + escapeHtml(identifier) + '</span>';

        openChoiceDialog({
            title: 'We could not find that account',
            body: [
                '<p>Nothing in our records matches ' + typed + '.</p>',
                '<p>That usually means one of two things: the account is saved under a different email or phone number, or there is no account here yet.</p>',
                '<p class="text-[#12170f] font-semibold">How would you like to carry on?</p>'
            ].join(''),
            actions: [
                {
                    label: 'Try a different email or phone',
                    onPick: () => {
                        const field = document.getElementById('account-identifier');
                        if (!field) return showSignIn();

                        // Selected, not merely focused: the next thing typed
                        // replaces what did not work, which is what somebody
                        // reaching for a second address is about to do.
                        field.focus({ preventScroll: true });
                        field.select();
                    }
                },
                {
                    label: 'Create a new account',
                    primary: true,
                    onPick: () => showSignUp(prefillFrom(identifier))
                }
            ]
        });
    }

    // ------------------------------------------------------------------
    // ACTIONS
    // ------------------------------------------------------------------
    async function onSignIn(event) {
        event.preventDefault();

        const scroll = body();
        if (!scroll) return;

        clearErrorsIn(scroll, 'account-form-error');
        setBusy(true, 'Signing in…');

        const identifier = document.getElementById('account-identifier').value.trim();

        const result = await account.signIn({ identifier });

        if (!handle) return;   // closed while we were away

        if (!result.ok) {
            setBusy(false, 'Sign In');

            // "No such account" is a fork, not a validation failure, so it
            // gets the dialog rather than a red line under the field. The
            // server flags it explicitly (account_not_found) rather than the
            // client matching on the wording of a sentence.
            if (result.accountNotFound) {
                return showNoAccountDialog(identifier);
            }

            // Anything else is a refusal this form cannot act on, so it gets
            // the same plain banner every other refusal does. Deliberately
            // without a reason and without anywhere to go: the server does
            // not say why an account it will not sign in was refused, and
            // guessing here on the wording of a sentence would put the
            // disclosure back that the server declined to make.

            return reportFailure(result);
        }

        // Whoever reaches this line is a customer — the login route refuses
        // every other role above — so the only question left is the one this
        // form has always asked: have they finished signing up?

        if (account.needsOnboarding()) showOnboarding();
        else finishAuthentication();
    }

    async function onSignUp(event) {
        event.preventDefault();

        const scroll = body();
        if (!scroll) return;

        clearErrorsIn(scroll, 'account-form-error');

        // Step 01 collects the three columns user_profiles will not accept a
        // row without, so it is checked here before the round trip.
        const firstBad = validateProfile();
        if (firstBad) {
            firstBad.focus({ preventScroll: true });
            showBanner('Check the highlighted fields and try again.');
            return;
        }

        setBusy(true, 'Creating…');

        const result = await account.signUp({
            name: document.getElementById('account-name').value.trim(),
            email: document.getElementById('account-email').value.trim(),
            phone: document.getElementById('account-phone').value.trim(),
            company: document.getElementById('account-company').value.trim()
        });

        if (!handle) return;

        if (!result.ok) {
            setBusy(false, 'Continue');
            return reportFailure(result);
        }

        // The account exists from here on. Step 02 is the address.
        showOnboarding();
    }

    async function onSaveProfile(event, next) {
        event.preventDefault();

        const scroll = body();
        if (!scroll) return;

        clearErrorsIn(scroll, 'account-form-error');

        const firstBad = validateProfile();
        if (firstBad) {
            firstBad.focus({ preventScroll: true });
            showBanner('Check the highlighted fields and try again.');
            return;
        }

        setBusy(true, 'Saving…');

        const result = await account.updateProfile(readProfileForm());

        if (!handle) return;

        if (!result.ok) {
            setBusy(false, 'Save Changes');
            showBanner(result.error || 'Could not save your details. Try again.');
            return;
        }

        next();
    }

    async function onSignOut() {
        await account.signOut();
        if (handle) showSignedOut();
    }

    // A failure that names a field is put against that field; one that does not
    // goes in the banner. Either way it is said once, not twice.
    function reportFailure(result) {
        const field = result.field ? document.getElementById('account-' + result.field) : null;

        if (field) {
            fieldError(field, result.error);
            field.focus({ preventScroll: true });
            return;
        }

        showBanner(result.error || 'Something went wrong. Try again.');
    }

    // ------------------------------------------------------------------
    // LIFECYCLE
    // ------------------------------------------------------------------
    // Nothing is on screen until the first /api/auth/me has landed, or the
    // overlay would paint "Sign In" at a visitor who is already signed in and
    // then swap it out from under them a moment later.
    function loadingHTML() {
        return centredMessageHTML('<p class="text-sm text-[#1f271b]/50">Loading your account…</p>');
    }

    function route() {
        if (!account.isSignedIn()) showSignIn();
        else if (account.needsOnboarding()) showOnboarding();
        else showAccount();
    }

    async function open() {
        if (handle) return;

        handle = chrome.openOverlay({
            id: 'account-overlay',
            titleId: 'account-title',
            closeId: 'account-close',
            header: chrome.headerHTML({
                titleId: 'account-title',
                title: 'Your Account',
                subtitle: 'Your contact and delivery details, and everything you have ordered from us.',
                closeId: 'account-close',
                closeLabel: 'Close account'
            }),
            onClose: () => {
                handle = null;
            }
        });

        // Where you land depends on where you already are, which is the whole
        // difference between this and the state machine it replaced.
        if (account.isLoaded()) {
            route();
            return;
        }

        paint(loadingHTML());
        await account.ready;

        if (!handle) return;   // closed while we were away
        route();
    }

    function close() {
        if (handle) handle.close();
    }

    function attach() {
        const button = document.getElementById('profile-button');
        if (!button) return;

        button.addEventListener('click', (event) => {
            event.preventDefault();
            open();
        });

        // A link from off the page can ask for this overlay by name — the
        // the checkout page's "sign in" does.
        // The hash is stripped as it opens, exactly as request-quote-module.js
        // does with #quote and for the same reason: a refresh should not
        // reopen a form the visitor has already closed. replaceState rather
        // than assigning location.hash, which would add a history entry and
        // make Back reopen it.
        if (window.location.hash === '#account') {
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            open();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();

    window.storeAccount = { open, close };
})();
