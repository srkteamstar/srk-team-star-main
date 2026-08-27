/*
 * enquiry-form-module.js — the one enquiry form implementation
 * ============================================================================
 *
 * There were five. index.html, contact.html, catalogue.html and
 * store/store.html each carried their own inline <script> submit handler, and
 * legal-enquiry-form-module.js was a sixth-of-a-kind for the six policy pages.
 * All of them POSTed the same fields to the same route.
 *
 * They had already drifted, which is what duplication costs and why this
 * exists:
 *
 *   index.html reset the button label to a HARDCODED 'Send Enquiry' in its
 *   finally block rather than restoring what the button actually said, so any
 *   page whose button read differently would have been quietly relabelled by
 *   submitting it.
 *
 *   index.html bound its handler at parse time with no DOMContentLoaded guard
 *   and no null check — getElementById('enquiry-form') straight into
 *   .addEventListener. It worked only because the script tag happened to sit
 *   below the form.
 *
 *   The legal module painted its success message text-[#420c14], a dark
 *   maroon, onto the dark #12170f enquiry panel. Near-invisible: the one piece
 *   of feedback confirming the enquiry was sent could not be read.
 *
 *   Only the legal module called reportValidity(). None of the five cleared a
 *   stale status message before submitting, so a failure followed by a success
 *   left both visible in sequence with a 5s timer racing them.
 *
 *   Three of the five hid the status message after 5 seconds and two did not.
 *
 * None of that is a design decision. It is five copies aging apart.
 *
 * WHAT THE MARKUP HAS TO PROVIDE
 * ---------------------------------------------------------------------------
 * A <form> with data-enquiry-form, and inside it the fields by id: form-name,
 * form-company, form-email, form-phone, form-message. `name` attributes are
 * set here if the markup omits them, which is what the six policy pages
 * relied on and what keeps their markup unchanged.
 *
 * Optional: #submit-btn (else the first submit button) and #form-status (else
 * one is created and appended). data-enquiry-accent names the colour of the
 * success line; it defaults to gold, and the policy pages take that same gold
 * because their panel is dark.
 *
 * WHY `action` POINTS AT THE REAL ROUTE
 * ---------------------------------------------------------------------------
 * These forms carried action="#", which is not a fallback — it is a form that
 * reloads the page it is on and silently discards what was typed. With
 * JavaScript disabled or broken, an enquiry looked sent and went nowhere.
 *
 * action="/api/submit-form" with method="post" is set here, and in the markup
 * too so that it is true before this file runs. The route answers a form-
 * encoded POST from a browser with a redirect back to the page carrying
 * ?enquiry=sent or ?enquiry=failed, so the no-JS path genuinely works. This
 * module intercepts and posts JSON when it is running, which is every normal
 * visit.
 */
(function () {
    'use strict';

    if (window.srkEnquiryForm) return;

    const ENDPOINT = '/api/submit-form';
    const DEFAULT_ACCENT = '#d4af37';

    // The five copies disagreed on both of these. One sentence, one number.
    const SUCCESS = 'Thank you. Your enquiry has been sent.';
    const FAILURE = 'We could not send your enquiry. Please try again, or call +91 90500 09442.';

    const FIELD_NAMES = {
        'form-name': 'full_name',
        'form-company': 'company',
        'form-email': 'email',
        'form-phone': 'phone',
        'form-message': 'message'
    };

    function statusFor(form) {
        const existing = form.querySelector('#form-status, [data-enquiry-status]');
        if (existing) return existing;

        const created = document.createElement('p');
        created.id = 'form-status';
        created.setAttribute('data-enquiry-status', '');
        created.className = 'mt-4 text-sm font-bold hidden';
        form.appendChild(created);
        return created;
    }

    function wire(form) {
        if (form.dataset.enquiryWired === 'true') return;
        form.dataset.enquiryWired = 'true';

        // Named here rather than in six copies of the markup. A field the page
        // did not name would otherwise be dropped by FormData without comment.
        Object.entries(FIELD_NAMES).forEach(([id, name]) => {
            const field = form.querySelector('#' + id);
            if (field && !field.getAttribute('name')) field.setAttribute('name', name);
        });

        if (!form.querySelector('input[name="form_type"]')) {
            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = 'form_type';
            hidden.value = 'enquiry';
            form.prepend(hidden);
        }

        // True before this file runs (the markup says so too), so the no-JS
        // path is real. Re-asserted here for a form built at runtime.
        form.setAttribute('action', ENDPOINT);
        form.setAttribute('method', 'post');

        const accent = form.getAttribute('data-enquiry-accent') || DEFAULT_ACCENT;
        const button = form.querySelector('#submit-btn') || form.querySelector('button[type="submit"]');
        const status = statusFor(form);

        // role/aria-live so the outcome is announced. Every copy of this drew
        // the message and not one of them said it.
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        let hideTimer = null;

        function show(message, colour) {
            window.clearTimeout(hideTimer);
            status.textContent = message;
            status.style.color = colour;
            status.classList.remove('hidden');
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            // Native validation, explicitly. The markup carries `required` and
            // type="email", and letting the browser enforce them keeps the
            // messages localised and the focus handling correct.
            if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;

            // Restored from what the button actually said, not from a
            // hardcoded string — index.html's copy reset every button to
            // 'Send Enquiry' regardless of what was on it.
            const original = button ? button.textContent : '';

            if (button) {
                button.disabled = true;
                button.textContent = 'Sending…';
            }

            // Cleared before the request, so a previous failure is not still
            // on screen while the next attempt is in flight.
            window.clearTimeout(hideTimer);
            status.classList.add('hidden');

            try {
                const response = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
                });

                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Submission failed');

                form.reset();
                show(SUCCESS, accent);

                // Success fades; a failure stays. Somebody who could not send
                // an enquiry needs the phone number in that sentence to still
                // be there when they look back at the screen.
                hideTimer = window.setTimeout(() => status.classList.add('hidden'), 6000);
            } catch (error) {
                console.error('Enquiry submission failed.', error);
                show(FAILURE, '#b91c1c');
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = original;
                }
            }
        });
    }

    function init() {
        document.querySelectorAll('form[data-enquiry-form]').forEach(wire);

        // ?enquiry=sent|failed — the no-JS path came back through the server's
        // redirect. Reported through the same status line, then stripped from
        // the URL so a refresh does not repeat it.
        const params = new URLSearchParams(window.location.search);
        const outcome = params.get('enquiry');
        if (outcome !== 'sent' && outcome !== 'failed') return;

        const form = document.querySelector('form[data-enquiry-form]');
        if (form) {
            const status = statusFor(form);
            status.textContent = outcome === 'sent' ? SUCCESS : FAILURE;
            status.style.color = outcome === 'sent'
                ? (form.getAttribute('data-enquiry-accent') || DEFAULT_ACCENT)
                : '#b91c1c';
            status.classList.remove('hidden');
        }

        params.delete('enquiry');
        const query = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    }

    window.srkEnquiryForm = { init, wire };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
