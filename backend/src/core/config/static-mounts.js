/*
 * core/config/static-mounts.js — the URL -> folder contract, written once
 * ============================================================================
 *
 * THE PAGE URLS DID NOT CHANGE, AND THAT IS THE POINT.
 *
 * `/index.html`, `/catalogue.html`, `/store/store.html`, `/blog/<slug>/`,
 * `/legal/<policy>.html`, `/assets/**` and `/robots.txt` all answer exactly
 * what they answered before the restructure. They are the contract: every
 * footer on the site links them, they are in customers' bookmarks, and a
 * crawler has them. Only the browser MODULES moved, from the site root to
 * `/js/<layer>/...`, and every `<script src>` moved with them.
 *
 * This table is the single statement of that mapping. Two things read it, and
 * that is what stops it drifting:
 *
 *   core/http/static-files.js   mounts each entry on the app, in order
 *   tools/verify-links.js       resolves every href/src in every page and
 *                               every module against these mounts, so a
 *                               reference that no mount can serve fails the
 *                               build rather than 404-ing in production
 *
 * ORDER MATTERS. Express tries mounts in the order they are registered, so the
 * narrow prefixes (`/js`, `/assets`) come before the two that answer at the
 * root. `public` precedes `pages` because a file that must answer from the
 * site root should win over a same-named page, and because it is the smaller,
 * more deliberate set.
 */
const paths = require('./paths');

/**
 * @typedef {object} StaticMount
 * @property {string} urlPrefix  the mount point, '/' for the site root
 * @property {string} dir        the directory served there
 * @property {string} why        what lives here, for the verifier's messages
 */

/** @type {StaticMount[]} */
const STATIC_MOUNTS = [
    {
        urlPrefix: '/js',
        dir: paths.JS_ROOT,
        why: 'browser modules — platform, shared and one folder per feature'
    },
    {
        urlPrefix: '/assets',
        dir: paths.ASSETS_ROOT,
        why: 'images, product photography, vendored fonts and the compiled stylesheet'
    },
    {
        urlPrefix: '/',
        dir: paths.PUBLIC_ROOT,
        why: 'files that must answer from the site root (robots.txt)'
    },
    {
        urlPrefix: '/',
        dir: paths.PAGES_ROOT,
        why: 'the HTML documents, including store/ and blog/'
    }
];

/**
 * Server-rendered URLs that no mount can satisfy because no file sits behind
 * them. The six policy pages are one template filled in by a route
 * (modules/legal), and `/` is index.html by way of a sendFile.
 *
 * The verifier needs to know these are real destinations, or every footer on
 * the site would report six broken links. They are listed rather than pattern
 * matched so that adding a policy is a deliberate act in two places — here and
 * in policy-loader.js — instead of a regex quietly widening.
 */
const ROUTED_URLS = [
    '/',
    '/legal/home.html',
    '/legal/privacy-policy.html',
    '/legal/terms-of-service.html',
    '/legal/shipping-policy.html',
    '/legal/return-policy.html',
    '/legal/support-policy.html'
];

module.exports = { STATIC_MOUNTS, ROUTED_URLS };
