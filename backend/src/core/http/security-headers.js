/*
 * core/http/security-headers.js — deny by default, on every response
 * ============================================================================
 *
 * The two per-document grants (Google Maps, Razorpay checkout) are still READ
 * from the markup rather than written down here, which is what stops the list
 * going stale the first time somebody adds or removes one. What changed with
 * the restructure is only where the scan looks: frontend/pages, plus the legal
 * shell template, instead of the whole project directory.
 */
const fs = require('fs');
const path = require('path');
const paths = require('../config/paths');
const { ROUTED_URLS } = require('../config/static-mounts');

// ==========================================
// RESPONSE HEADERS — deny by default
// ==========================================
//
// There were none of these at all: no CSP, no framing rule, no referrer
// policy, no Permissions-Policy. Each is a capability the browser grants a
// page unless told otherwise, so "this site does not use the camera" was
// never the same as "this page cannot use the camera" — an injected script
// could.
//
// PERMISSIONS-POLICY
// The application was searched for every powerful browser capability and uses
// NONE of them: no getUserMedia, no geolocation, no Notification, no
// clipboard read, no file picker, no WebRTC, no service worker, no WebSocket,
// no IndexedDB. (The only navigator.credentials in the tree is inside
// @supabase/auth-js, which runs server-side and is never served.) The policy
// therefore denies the lot with `=()` — an empty allow list, not even self.
//
// CONTENT-SECURITY-POLICY
// default-src 'none', then only what is proven necessary:
//   script-src  'self' plus 'unsafe-inline'. The inline part is not a free
//               choice: there is no build step, there are twelve inline
//               onclick= attributes and eleven inline <script> blocks across
//               the pages, and the modules hand-build more markup that
//               carries handlers. Removing it means extracting those, which
//               is real work and a separate change. What it still buys is
//               that no EXTERNAL host is a script source any more — Tailwind
//               and Lenis are vendored same-origin, so nothing here needs to
//               name cdn.tailwindcss.com or unpkg.com.
//   connect-src 'self'. This one is the prize. Whatever runs on the page,
//               injected or not, cannot fetch, XHR, sendBeacon or open a
//               socket to anywhere but this origin. That is the exfiltration
//               channel, and it is closed.
//   img-src     'self' data:, plus the Supabase storage origin, which is
//               where product, category and project images actually live.
//   style-src   'self' 'unsafe-inline' — Tailwind's CDN build injects a
//               <style> element it generates at runtime, and every page
//               carries an inline <style> block of its own.
//   font-src    'self'. The fonts are vendored; nothing loads from Google.
//   frame-src   'none' by default; the two pages with a map opt in below.
//   frame-ancestors 'none' — no page here can be framed, so
//               there is nothing to clickjack. X-Frame-Options repeats it for
//               anything predating CSP level 2.
//   form-action 'self' — an injected <form> cannot post fields the visitor
//               has already typed to another host.
//   base-uri 'none' — a <base> tag cannot silently repoint every relative
//               script URL on the page.
const SUPABASE_STORAGE_ORIGIN = (() => {
    try {
        return new URL(process.env.SUPABASE_URL).origin;
    } catch (error) {
        return '';
    }
})();

const CSP_BASE = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:" + (SUPABASE_STORAGE_ORIGIN ? ' ' + SUPABASE_STORAGE_ORIGIN : ''),
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'none'"
];

// FRAME-SRC IS GRANTED PER DOCUMENT, AND THE LIST IS READ, NOT WRITTEN.
//
// Nine pages carry a Google map — catalogue, store, index and all six legal
// pages. It no longer loads on sight: the served markup holds a placeholder
// and the <iframe> is built only by the click that asks for it
// (map-consent-module.js). Until then nothing leaves this origin.
//
// The click still needs frame-src on that document, and a hand-written list
// of nine paths is a list that goes stale the first time somebody adds or
// removes a map — silently, and in the direction that breaks the feature or
// over-grants the policy. So the pages are found by looking: one pass over
// the project's HTML at boot, matching the same data-map-embed attribute the
// module itself binds to. Adding a map to a page grants that page frame-src
// on the next restart; removing one revokes it. There is nothing to keep in
// sync because there is nothing written down twice.
// Two policies are now granted per document by exactly this method — the map
// and the payment gateway — so the scan itself is one function rather than
// two copies of a directory walk that would drift the first time one of them
// learned something the other did not.

// The walk is scoped to frontend/pages/ rather than to the project root. In
// `#1` it started at the served root and had to skip `backend`, `node_modules`
// and every dotfile on the way past — a skip list that would have needed a new
// entry the day anybody added a directory. Here the pages ARE the tree, so
// there is nothing to exclude, and a page's URL is simply its path below that
// root. Server-rendered documents (the six legal pages) carry no marker and
// need none: their shell is scanned as a template alongside them.
function htmlPagesContaining(marker) {
    const roots = [
        { dir: paths.PAGES_ROOT, prefix: '/' }
    ];
    const pages = new Set();

    const walk = (dir, prefix) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;

            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, `${prefix}${entry.name}/`);
            } else if (entry.name.toLowerCase().endsWith('.html')) {
                try {
                    if (fs.readFileSync(full, 'utf8').includes(marker)) {
                        pages.add(`${prefix}${entry.name}`);
                    }
                } catch (error) {
                    // An unreadable file simply does not get the grant.
                }
            }
        }
    };

    roots.forEach(({ dir, prefix }) => walk(dir, prefix));

    // The legal shell is one template served at six URLs, so it is scanned
    // once and its grant is spread across the paths the route answers on.
    // Without this the policy pages would carry a map placeholder that could
    // never load, which is the failure mode this scan exists to prevent —
    // just moved from "a page nobody listed" to "a page with no file".
    try {
        if (fs.readFileSync(paths.LEGAL_SHELL_HTML, 'utf8').includes(marker)) {
            ROUTED_URLS.filter(url => url.startsWith('/legal/')).forEach(url => pages.add(url));
        }
    } catch (error) {
        // No shell, no grant. The legal route will have said so louder.
    }

    // '/' serves index.html, so it needs the same answer that path would get.
    if (pages.has('/index.html')) pages.add('/');

    return pages;
}


const MAP_FRAME_PAGES = (() => {
    const pages = htmlPagesContaining('data-map-embed');
    console.log(`CSP: frame-src granted to Google Maps on ${pages.size} page(s) carrying a consent placeholder.`);
    return pages;
})();

// RAZORPAY IS THE ONE THIRD-PARTY SCRIPT THIS SITE STILL LOADS, AND IT IS
// GRANTED ON ONE PAGE.
//
// Tailwind, Lenis and the fonts were vendored precisely so no external origin
// is a script source. A payment gateway cannot be vendored: checkout.js is
// served by Razorpay, updated by Razorpay, and handling card details inside
// their iframe rather than this origin is what keeps this site out of PCI
// scope. So it is an exception, and it is confined the same way the map is —
// by document, from a marker read out of the HTML rather than a path list
// written down twice.
//
// The directives are what Razorpay's checkout actually needs:
//   script-src   checkout.js itself
//   frame-src    the modal, and the bank/UPI pages it hands off to
//   connect-src  the API and Razorpay's own telemetry host
//   img-src      card-network and bank logos inside the modal
//   form-action  3-D Secure posts the browser out to the issuing bank
//
// connect-src is the one to note. `'self'` alone is this site's strongest
// single control — it is the exfiltration channel, and it is otherwise shut.
// Widening it at all is a real cost, which is why it is widened on the
// checkout page only and to two named hosts rather than to *.razorpay.com.
const RAZORPAY_PAGES = (() => {
    const pages = htmlPagesContaining('data-razorpay-checkout');
    console.log(`CSP: Razorpay checkout granted on ${pages.size} page(s).`);
    return pages;
})();

const RAZORPAY_CSP = {
    'script-src': ['https://checkout.razorpay.com'],
    'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    'connect-src': ['https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
    'img-src': ['https://cdn.razorpay.com'],
    'form-action': ['https://api.razorpay.com']
};

// `ambient-light-sensor` and `battery` were in this list and are deliberately
// NOT any more. Neither is a Permissions-Policy feature any shipping browser
// recognises — the Battery Status API never got a policy-controlled name and
// the ambient light sensor was dropped before it shipped — so Chrome answered
// each with `Error with Permissions-Policy header: Unrecognized feature` in
// the console of every page on the site. A token no browser understands denies
// nothing; all it did was put two red errors in front of every real one. The
// intent is unchanged, because there was never a capability here to deny.
const PERMISSIONS_POLICY = [
    'accelerometer=()', 'autoplay=()',
    'bluetooth=()', 'browsing-topics=()', 'camera=()', 'display-capture=()',
    'encrypted-media=()', 'fullscreen=()', 'gamepad=()', 'geolocation=()',
    'gyroscope=()', 'hid=()', 'idle-detection=()', 'local-fonts=()',
    'magnetometer=()', 'microphone=()', 'midi=()', 'payment=()',
    'picture-in-picture=()', 'publickey-credentials-create=()',
    'publickey-credentials-get=()', 'screen-wake-lock=()', 'serial=()',
    'usb=()', 'web-share=()', 'window-management=()', 'xr-spatial-tracking=()',
    // Chrome's advertising and measurement surfaces. Denied explicitly
    // because they are enabled by default in the browsers that ship them.
    'attribution-reporting=()', 'interest-cohort=()', 'join-ad-interest-group=()',
    'run-ad-auction=()', 'private-state-token-issuance=()',
    'private-state-token-redemption=()', 'shared-storage=()',
    'shared-storage-select-url=()'
].join(', ');

function securityHeaders(req, res, next) {
    // Built by directive rather than by concatenating a string, because two
    // per-document grants can now land on one page and a page carrying both
    // must get the union — a second `frame-src` line would be ignored by the
    // browser (first occurrence wins), silently dropping whichever grant was
    // written second.
    const directives = new Map(CSP_BASE.map(entry => {
        const gap = entry.indexOf(' ');
        return [entry.slice(0, gap), entry.slice(gap + 1).split(' ')];
    }));

    const grant = (name, sources) => {
        const existing = directives.get(name) || [];
        // A directive that reads 'none' is a refusal, not a list to append to:
        // "frame-src 'none' https://x" is invalid and blocks everything.
        const base = existing.length === 1 && existing[0] === "'none'" ? [] : existing;
        directives.set(name, base.concat(sources.filter(source => !base.includes(source))));
    };

    directives.set('frame-src', ["'none'"]);

    if (MAP_FRAME_PAGES.has(req.path)) {
        grant('frame-src', ['https://maps.google.com', 'https://www.google.com']);
    }

    if (RAZORPAY_PAGES.has(req.path)) {
        Object.entries(RAZORPAY_CSP).forEach(([name, sources]) => grant(name, sources));
    }

    const csp = [...directives.entries()]
        .map(([name, sources]) => `${name} ${sources.join(' ')}`)
        .join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // no-referrer rather than the usual strict-origin-when-cross-origin: the
    // only cross-origin request this site still makes is an image fetch to
    // Supabase storage, and that host has no business being told which page
    // wanted it.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Only over TLS. Sent unconditionally on a plain-HTTP dev server it would
    // pin localhost to https for a year in the developer's own browser.
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
}

module.exports = { securityHeaders, htmlPagesContaining, CSP_BASE, PERMISSIONS_POLICY };
