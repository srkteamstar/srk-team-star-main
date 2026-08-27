/*
 * modules/enquiries/services/enquiry-redirect.service.js
 * ============================================================================
 *
 * The no-JavaScript path. Everything here exists because the enquiry forms
 * post for real rather than carrying `action="#"`, and a browser navigating a
 * form must not be answered with JSON.
 */
// ==========================================
// A BROWSER POSTING A <form> IS NOT AN XHR, AND MUST NOT BE ANSWERED WITH JSON.
//
// The enquiry forms post to this route for real now, so that they work with
// JavaScript disabled or broken. When JS is running, enquiry-form-module.js
// intercepts and sends JSON, and everything below is unchanged for it.
//
// When it is not, the browser navigates. Answering that navigation with
// `{"success":true}` would leave the visitor staring at a page of JSON with no
// way back, which is barely better than the action="#" it replaced. So a
// form-encoded post is answered with a redirect to the page it came from,
// carrying ?enquiry=sent or ?enquiry=failed — which enquiry-form-module.js
// reports through the same status line and then strips from the URL.
function wantsRedirect(req) {
    return req.is('application/x-www-form-urlencoded') === 'application/x-www-form-urlencoded';
}

// THE DESTINATION IS DERIVED, NEVER TAKEN FROM THE REQUEST.
//
// The obvious implementation reads a `return_to` field out of the body, and
// that is an open redirect: this site would then forward anyone anywhere,
// which is a phishing primitive worth having. The Referer is used instead, and
// only its PATH — parsed, checked to be same-origin, and rebuilt from its
// pathname alone, so neither a foreign host nor a scheme can survive the trip.
// Anything unparseable falls back to the contact page, which is where an
// enquiry form always exists.
function enquiryRedirect(req, res, outcome) {
    let path = '/contact.html';

    try {
        const referer = req.get('referer');
        if (referer) {
            const url = new URL(referer);
            if (url.host === req.get('host')) path = url.pathname;
        }
    } catch (error) {
        // Unparseable Referer. The fallback stands.
    }

    return res.redirect(303, path + '?enquiry=' + outcome);
}

module.exports = { wantsRedirect, enquiryRedirect };
