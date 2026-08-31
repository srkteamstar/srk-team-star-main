/*
 * core/http/static-files.js — the frontend, mounted from one table
 * ============================================================================
 *
 * STATIC FILES
 *
 * Stable source URLs remain available, and must revalidate when their contents
 * change. Express defaults to `max-age=0` here, which a browser is free
 * to treat as a hint: Chrome will serve a soft-reloaded page out of its
 * in-memory cache and run a stale module against a current API. That is what
 * produced the 410 from /api/submit-form below — a cached copy of
 * request-quote-module.js posting to the endpoint quotes left.
 *
 * `no-cache` is the stronger promise: store it, but revalidate every single
 * time. The browser sends If-None-Match and gets a cheap 304 unless the file
 * really did change, so this costs a header round trip, not a re-download.
 *
 * Content-hashed generated JS, CSS, fonts and image variants instead receive
 * one-year immutable caching. Their URL changes whenever their bytes change.
 * Other images and fonts under assets/ retain the default cache policy.
 *
 * WHAT CHANGED IN THE RESTRUCTURE
 * ---------------------------------------------------------------------------
 * One `express.static(projectRoot)` became four mounts read from
 * core/config/static-mounts.js. The cache rule is unchanged and now applies to
 * every mount that can hold a `.js`, `.css` or `.html`, which is what keeps the
 * browser-modules mount (`/js`) revalidating the way the site root used to.
 *
 * `dotfiles: 'ignore'` stays explicit on every mount even though `.env` is no
 * longer anywhere near a served directory. It costs a line and it is the kind
 * of default that should never be the only thing holding.
 */
const express = require('express');
const { STATIC_MOUNTS } = require('../config/static-mounts');
const paths = require('../config/paths');
const { pageFiles, sendHtmlPage } = require('./page-metadata');

const BEHAVIOUR_FILE = /\.(?:js|css|html)$/i;
// Only content-addressed build output may be immutable. Auth, checkout, HTML
// and stable source URLs retain their existing cache policy.
const IMMUTABLE_ASSET = /[\\/]assets[\\/](?:versioned[\\/][a-f0-9]{16}[\\/][^\\/]+\.(?:js|css|woff2)|optimized[\\/][^\\/]+\.[a-f0-9]{16}\.(?:webp|png))$/i;

/**
 * Vercel ignores express.static(), and its CDN serves assets and browser
 * modules from the committed root public/ directory. HTML deliberately stays
 * in the function so it still passes through securityHeaders and receives the
 * same per-document CSP as every other deployment.
 *
 * Reproduce express.static's page URL mapping without turning every product
 * image into function payload: ordinary files keep their path below pages/;
 * an index.html also answers its directory URL and redirects the no-slash form
 * the way serve-static does.
 *
 * @param {import('express').Express} app
 */
function mountVercelPages(app) {
    const fs = require('fs');
    const path = require('path');

    const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;

            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.name.toLowerCase().endsWith('.html')) continue;

            const relative = path.relative(paths.PAGES_ROOT, full).split(path.sep).join('/');
            const fileUrl = `/${relative}`;
            const send = (req, res) => {
                res.setHeader('Cache-Control', 'no-cache');
                sendHtmlPage(req, res, fs.readFileSync(full, 'utf8'), res.locals.pageMetadata);
            };

            app.get(fileUrl, send);

            if (entry.name.toLowerCase() === 'index.html') {
                const directoryUrl = fileUrl.slice(0, -'index.html'.length);
                if (directoryUrl && directoryUrl !== '/') {
                    const withoutSlash = directoryUrl.slice(0, -1);
                    app.get(withoutSlash, (req, res, next) => {
                        if (req.path.endsWith('/')) return next();
                        return res.redirect(301, `${req.path}/`);
                    });
                }

                app.get(directoryUrl || '/', send);
            }
        }
    };

    walk(paths.PAGES_ROOT);
}

/**
 * Registers every mount, in table order.
 *
 * @param {import('express').Express} app
 */
function mountStaticFiles(app) {
    if (process.env.VERCEL) {
        mountVercelPages(app);
        return;
    }

    // Only exact, known HTML documents are rendered. Assets keep their original
    // static semantics; no user-supplied path is ever passed to the filesystem.
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const file = pageFiles.get(req.path);
        if (!file) return next();
        try { return sendHtmlPage(req, res, require('fs').readFileSync(file, 'utf8'), res.locals.pageMetadata); }
        catch (error) { return next(error); }
    });

    STATIC_MOUNTS.forEach(({ urlPrefix, dir }) => {
        app.use(urlPrefix, express.static(dir, {
            dotfiles: 'ignore',
            etag: true,
            lastModified: true,
            setHeaders: (res, filePath) => {
                if (IMMUTABLE_ASSET.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else if (BEHAVIOUR_FILE.test(filePath)) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            }
        }));
    });

    // A backstop rather than the usual path: `express.static` already answers
    // `/` with pages/index.html through its own index resolution, and did in
    // `#1` too, where this same route sat below the static handler and was
    // reached only if that resolution ever stopped happening. Kept in the same
    // relative position so it keeps meaning the same thing.
    app.get('/', (req, res) => {
        res.sendFile(paths.INDEX_HTML);
    });
}

module.exports = { mountStaticFiles };
