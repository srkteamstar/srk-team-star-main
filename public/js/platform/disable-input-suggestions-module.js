/**
 * disable-input-suggestions-module.js
 *
 * Turns off every browser/password-manager suggestion surface on every field of
 * the site — the autofill dropdown, the form-history dropdown, the mobile
 * predictive-text bar and the extension overlays.
 *
 * Why a runtime sweep and not just attributes in the markup:
 *
 *   - Almost every field on this site is stringified into innerHTML at render
 *     time (the storefront section loaders, the auth modal in
 *     profile-icon-loader.js). Attributes still go in the source markup as the
 *     no-JS baseline, but a MutationObserver is the only thing that can promise
 *     "no field anywhere", including fields that do not exist at load.
 *   - No autocomplete value is enough on its own. Chrome ignores every opt-out,
 *     "off" and unrecognised tokens alike, on any field its own classifier reads
 *     as part of an address — a person's name, an organisation, an email, a
 *     phone number, a street. That is a deliberate Chromium decision, so a field
 *     labelled "Business Name" is offered the visitor's saved company however it
 *     is marked up. AUTOCOMPLETE_OFF still ships, because it does stop the
 *     fields Chrome has not classified and every password manager reads it —
 *     the address-classified ones are the accepted gap. A readonly guard used
 *     to close that gap and cost every field on the site its text cursor; see
 *     the note below for why it was removed rather than kept.
 *
 * Drop-in and self-contained: no dependencies, no globals beyond the one hook
 * below, safe to load on any page in any position.
 *
 * Exposes window.disableInputSuggestions(root) so a module that builds markup by
 * hand can harden it immediately instead of waiting for the observer tick.
 */
(function () {
    'use strict';

    if (window.__srkNoAutofillLoaded) return;
    window.__srkNoAutofillLoaded = true;

    // See the note above. An unrecognised token is not stronger than "off" against
    // Chrome — nothing in this attribute is — but it is what the password-manager
    // extensions read, and it stops the fields Chrome never classified.
    var AUTOCOMPLETE_OFF = 'srk-no-autofill';

    // Applied to anything the user can type into. autocorrect/autocapitalize and
    // spellcheck are what drive the predictive-text strip above a mobile keyboard
    // and the spelling suggestion menu, so "no suggestions" means all three go.
    var TEXT_FIELD_ATTRS = {
        autocomplete: AUTOCOMPLETE_OFF,
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false'
    };

    // Password-manager and form-filler opt-outs. Each vendor reads its own.
    var EXTENSION_ATTRS = {
        'data-lpignore': 'true',      // LastPass
        'data-form-type': 'other',    // Dashlane
        'data-1p-ignore': '',         // 1Password
        'data-bwignore': 'true'       // Bitwarden
    };

    // Input types that hold no free text cannot open a suggestion list, so they
    // only need the autocomplete opt-out (Chrome still autofills date/tel/email
    // style fields, but never a checkbox or a file picker).
    var NON_TEXT_TYPES = {
        hidden: 1, submit: 1, reset: 1, button: 1, image: 1,
        checkbox: 1, radio: 1, range: 1, color: 1, file: 1
    };

    var FIELD_SELECTOR = 'input, textarea, select, form';

    function isTextEntry(el) {
        var tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag !== 'INPUT') return false;
        return !NON_TEXT_TYPES[(el.getAttribute('type') || 'text').toLowerCase()];
    }

    /**
     * Hardens one <input>, <textarea>, <select> or <form>.
     *
     * Idempotent, and the guard is a flag this function sets rather than the
     * autocomplete value: the source markup already ships the token, so keying
     * off the attribute would make every field written by hand skip the rest of
     * the treatment. The attribute is re-checked too, so a field something else
     * rewrote is hardened again on the next pass.
     */
    function harden(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.__srkHardened && el.getAttribute('autocomplete') === AUTOCOMPLETE_OFF) return;

        el.__srkHardened = true;
        el.setAttribute('autocomplete', AUTOCOMPLETE_OFF);

        if (el.tagName === 'FORM') return;

        var key;
        for (key in EXTENSION_ATTRS) {
            if (Object.prototype.hasOwnProperty.call(EXTENSION_ATTRS, key)) {
                el.setAttribute(key, EXTENSION_ATTRS[key]);
            }
        }

        if (isTextEntry(el)) {
            for (key in TEXT_FIELD_ATTRS) {
                if (Object.prototype.hasOwnProperty.call(TEXT_FIELD_ATTRS, key)) {
                    el.setAttribute(key, TEXT_FIELD_ATTRS[key]);
                }
            }
            // A `list` attribute points at a <datalist>, which is a suggestion
            // dropdown the browser draws no matter what autocomplete says.
            if (el.hasAttribute('list')) el.removeAttribute('list');
        }
    }

    // ------------------------------------------------------------------
    // WHY THERE IS NO READONLY GUARD HERE ANY MORE
    // ------------------------------------------------------------------
    // There used to be one: every text field sat `readonly` at rest and was
    // released for the width of a single keystroke, because Chrome will not
    // offer a suggestion on a field it cannot type into. It worked, and it
    // was the only thing that stopped Chrome autofilling the fields its own
    // classifier reads as part of an address (a name, an organisation, an
    // email, a phone, a street) where no autocomplete value has any effect.
    //
    // It also removed the text cursor from every input on the site. Chrome
    // paints no caret in a readonly field, and because the guard re-armed on
    // the `input`/`keyup` that each keystroke produced, the field was
    // readonly at every moment a caret could have been visible: at rest, on
    // focus, and between keystrokes. Measured, not assumed — readOnly was
    // true while focused and idle, and true again 500ms after typing.
    //
    // A caret is not decoration. It is how a person knows a field has focus,
    // where their next character will land, and that the site is listening at
    // all. Losing it on every field of a B2B site whose main job is collecting
    // enquiry, quote and checkout details costs more than an autofill dropdown
    // ever did, so the guard was removed by request.
    //
    // The trade is real and worth writing down: Chrome may again offer saved
    // values on address-classified fields. Nothing else regressed — the
    // attribute hardening below still stops every password-manager overlay,
    // the mobile predictive-text strip, the form-history dropdown and every
    // field Chrome never classified. Native `required` validation actually
    // got simpler: it skips readonly fields, so the guard needed a whole
    // release-on-submit dance that is now unnecessary.
    //
    // If the autofill popup ever becomes the bigger problem, restore the
    // guard from git history — but scope it to the address-classified fields
    // that need it rather than every input on the site, and accept that those
    // specific fields lose their caret again.

    /**
     * Hardens `root` itself when it is a field, plus every field beneath it.
     * Public as window.disableInputSuggestions.
     */
    function sweep(root) {
        var scope = root || document;
        if (scope.nodeType === 1 && scope.matches && scope.matches(FIELD_SELECTOR)) harden(scope);
        if (!scope.querySelectorAll) return;

        var fields = scope.querySelectorAll(FIELD_SELECTOR);
        for (var i = 0; i < fields.length; i++) harden(fields[i]);
    }

    window.disableInputSuggestions = sweep;

    sweep(document);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { sweep(document); });
    }

    // Every field on this site that matters is injected after load, so this is
    // the load-bearing half of the module, not a safety net.
    if (typeof MutationObserver === 'function') {
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) sweep(added[j]);
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Focus re-asserts the attributes, in case something rewrote them between
    // the observer tick and the click — a field rebuilt by a render that ran
    // in between would otherwise reach the visitor unhardened.
    document.addEventListener('focusin', function (event) {
        harden(event.target);
    }, true);

})();
