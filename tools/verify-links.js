#!/usr/bin/env node
/*
 * tools/verify-links.js — no reference in this project points at nothing
 * ============================================================================
 *
 * THE FAILURE THIS EXISTS TO CATCH. Moving 44 browser modules out of the site
 * root and into /js/<layer>/… means rewriting a `<script src>` in 22 HTML
 * documents. Get one wrong and nothing throws: the page still renders, the
 * server still answers 200 for every other file, and the only symptom is a
 * feature that quietly does not work — a cart that never opens, a filter row
 * that never appears. A 404 in a browser console is not a build failure, so
 * this makes it one.
 *
 * WHAT IT CHECKS
 *   every  src=  and  href=  in every page, the legal shell template, and
 *   every stylesheet reference, resolved against the SAME mount table the
 *   server serves them from (backend/src/core/config/static-mounts.js) —
 *   never against a second list written down here.
 *
 * That last part is the point. A verifier with its own copy of the routing
 * table is a verifier that passes while the site is broken, because it and the
 * server disagree about where files live. This one imports the table, so the
 * only way to fool it is to fool the server too.
 *
 * WHAT IS DELIBERATELY NOT AN ERROR
 *   external URLs           http(s):, mailto:, tel:, wa.me — not ours
 *   in-page fragments       #machinery, #quote — resolved by the page's own JS
 *   server-rendered URLs    the six legal pages and `/`, which have no file
 *                           behind them; they are listed in ROUTED_URLS in the
 *                           same table, so adding a policy is one edit
 *   data: URIs              inline images
 *
 * Run:  node tools/verify-links.js        (or: npm run verify:links)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { STATIC_MOUNTS, ROUTED_URLS } = require(
    path.join(ROOT, 'backend', 'src', 'core', 'config', 'static-mounts')
);

const PAGES_ROOT = path.join(ROOT, 'frontend', 'pages');
const TEMPLATES_ROOT = path.join(ROOT, 'backend', 'templates');
const JS_ROOT = path.join(ROOT, 'frontend', 'js');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const IGNORED_SCHEMES = /^(?:data|mailto|tel|javascript|blob):/i;

/** Resolve a site-absolute URL through the mount table, as the server would.
 *
 * The path is percent-DECODED first, because that is what the server does
 * before it touches the filesystem: `/assets/products/Trim%20Craft/…` is a
 * folder with a space in its name, and comparing the encoded form against a
 * directory listing reports a working image as a broken link. A malformed
 * escape is not decodable and cannot name a real file either, so it falls
 * through as a genuine failure. */
function resolveThroughMounts(rawPath) {
    let urlPath;
    try {
        urlPath = decodeURIComponent(rawPath);
    } catch (error) {
        return null;
    }

    for (const mount of STATIC_MOUNTS) {
        const prefix = mount.urlPrefix === '/' ? '' : mount.urlPrefix;
        if (prefix && !urlPath.startsWith(prefix + '/') && urlPath !== prefix) continue;

        const rest = urlPath.slice(prefix.length).replace(/^\/+/, '');
        const candidate = path.join(mount.dir, rest);

        // Directory URLs (/blog/<slug>/) are index.html, the way express.static
        // resolves them.
        const tries = rest === '' || urlPath.endsWith('/')
            ? [path.join(candidate, 'index.html')]
            : [candidate, path.join(candidate, 'index.html')];

        for (const t of tries) {
            try {
                if (fs.statSync(t).isFile()) return { mount, file: t };
            } catch (error) { /* next candidate */ }
        }
    }
    return null;
}

function walk(dir, match, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, match, out);
        else if (match.test(entry.name)) out.push(full);
    }
    return out;
}

const REFERENCE = /\b(?:src|href)\s*=\s*"([^"]+)"/gi;

function referencesIn(file) {
    const source = fs.readFileSync(file, 'utf8');
    const found = [];
    let m;
    while ((m = REFERENCE.exec(source)) !== null) {
        found.push({ url: m[1], line: source.slice(0, m.index).split('\n').length });
    }
    return found;
}

function main() {
    const documents = walk(PAGES_ROOT, /\.html$/i, [])
        .concat(walk(TEMPLATES_ROOT, /\.html$/i, []));

    const routed = new Set(ROUTED_URLS);
    const problems = [];
    let checked = 0;

    for (const doc of documents) {
        for (const { url, line } of referencesIn(doc)) {
            const clean = url.split('#')[0].split('?')[0];

            if (!clean || clean.startsWith('#')) continue;
            if (IGNORED_SCHEMES.test(clean)) continue;
            if (EXTERNAL.test(clean)) continue;

            if (!clean.startsWith('/')) {
                problems.push({
                    doc, line, url,
                    why: 'relative path — every reference in this project is site-absolute, '
                       + 'because a page under /store/ and a page at the root would resolve it differently'
                });
                continue;
            }

            checked++;
            if (routed.has(clean)) continue;
            if (resolveThroughMounts(clean)) continue;

            problems.push({ doc, line, url, why: 'no mount serves this path' });
        }
    }

    // The browser modules are checked too. They contain no <script src>, but
    // they do carry href/src attributes in the markup they build - the store's
    // cards, the cart drawer, the section loaders - and those 404 exactly as
    // silently.
    for (const mod of walk(JS_ROOT, /\.js$/i, [])) {
        for (const { url, line } of referencesIn(mod)) {
            const clean = url.split('#')[0].split('?')[0];
            if (!clean || clean.startsWith('#')) continue;
            if (IGNORED_SCHEMES.test(clean)) continue;
            if (EXTERNAL.test(clean)) continue;
            if (!clean.startsWith('/')) continue;   // built at runtime from data
            checked++;
            if (routed.has(clean)) continue;
            if (resolveThroughMounts(clean)) continue;
            problems.push({ doc: mod, line, url, why: 'no mount serves this path' });
        }
    }

    console.log(`verify-links: ${documents.length} document(s), ${checked} site-absolute reference(s) resolved through ${STATIC_MOUNTS.length} mount(s).`);

    if (problems.length) {
        console.error('\nBROKEN REFERENCES\n');
        for (const p of problems) {
            console.error(`  ${path.relative(ROOT, p.doc)}:${p.line}`);
            console.error(`      ${p.url}`);
            console.error(`      ${p.why}\n`);
        }
        console.error(`${problems.length} broken reference(s).`);
        process.exit(1);
    }

    console.log('verify-links: OK — every reference resolves.');
}

main();
