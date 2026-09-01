'use strict';

// Presentation only. Never infer the production origin from an untrusted Host
// header or a preview URL. Set SITE_ORIGIN when the public domain is confirmed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PAGES_ROOT } = require('../config/paths');
const { ROUTED_URLS } = require('../config/static-mounts');
const { escapeHtmlText: escape } = require('../../shared/text');

function siteOrigin() {
    try {
        const url = new URL(process.env.SITE_ORIGIN || '');
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
        if (url.hostname === 'localhost' || /^(?:127\.|0\.|\[::1\])/.test(url.hostname)) return '';
        return url.origin;
    } catch (_) { return ''; }
}

const pageFiles = new Map();
function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(file); continue; }
        if (!entry.name.endsWith('.html')) continue;
        const url = '/' + path.relative(PAGES_ROOT, file).split(path.sep).join('/');
        pageFiles.set(url, file);
        if (entry.name === 'index.html') pageFiles.set(url.slice(0, -10), file);
    }
}
scan(PAGES_ROOT);

function canonicalPath(url) { return url.replace(/index\.html$/, ''); }
function publicPagePaths() {
    return [...new Set([...pageFiles.keys(), ...ROUTED_URLS].map(canonicalPath))]
        .filter(url => url !== '/sitemap.xml' && !/\/store\/(?:checkout|payment)/.test(url)).sort();
}
const text = value => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function safeImage(value) {
    const url = String(value || '');
    return /^https:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : '';
}

function renderPageMetadata(html, requestPath, options = {}) {
    if (/\/store\/(?:checkout|payment)/.test(requestPath)) return html;
    const origin = siteOrigin();
    const pagePath = options.path || canonicalPath(requestPath);
    const pageTitles = {
        '/': 'Frame-making Machinery, Mouldings & Hardware | SRK Team Star',
        '/catalogue.html': 'Frame-making Machinery & Materials Catalogue | SRK Team Star',
        '/store/store.html': 'Shop Frame-making Machinery, Mouldings & Hardware | SRK Team Star'
    };
    let title = options.title || pageTitles[pagePath] || text((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    if (!/SRK Team Star/i.test(title)) title += ' | SRK Team Star';
    let description = options.description || (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1];
    if (!description && requestPath.startsWith('/legal/')) description = 'Read the ' + title.replace(/\s*\|.*$/, '') + ' for SRK Team Star products, purchases and customer support.';
    description = text(description || 'Explore SRK Team Star frame-making machinery, mouldings, hardware and workshop support.');
    // Existing descriptions are HTML-encoded in source. Preserve their entities
    // when serializing attributes rather than encoding them twice.
    const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    title = decode(title); description = decode(description);
    const article = /"@type"\s*:\s*"BlogPosting"/.test(html);
    const main = html.slice(html.indexOf('<main'));
    let image = safeImage(options.image || (main.match(/<img\b[^>]*\bsrc="([^"]+)"/) || [])[1] || '/assets/hero-image.png');
    if (image.startsWith('/')) image = origin ? origin + image : '';
    const tags = [
        `<title>${escape(title)}</title>`,
        `<meta name="description" content="${escape(description)}">`,
        `<meta property="og:type" content="${options.type || (article ? 'article' : 'website')}">`,
        '<meta property="og:site_name" content="SRK Team Star">',
        `<meta property="og:title" content="${escape(title)}">`,
        `<meta property="og:description" content="${escape(description)}">`,
        `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
        `<meta name="twitter:title" content="${escape(title)}">`,
        `<meta name="twitter:description" content="${escape(description)}">`
    ];
    if (origin) tags.push(`<link rel="canonical" href="${escape(origin + pagePath)}">`, `<meta property="og:url" content="${escape(origin + pagePath)}">`);
    if (image) tags.push(`<meta property="og:image" content="${escape(image)}">`, `<meta property="og:image:alt" content="${escape(options.imageAlt || title)}">`, `<meta name="twitter:image" content="${escape(image)}">`);
    if (pagePath === '/') {
        const org = { '@context': 'https://schema.org', '@type': 'Organization', name: 'SRK Team Star' };
        if (origin) Object.assign(org, { '@id': origin + '/#organization', url: origin, logo: origin + '/assets/icons/SRK-Team-Star-Logos/primary.png' });
        tags.push(`<script type="application/ld+json">${json(org)}</script>`);
        tags.push(`<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'SRK Team Star', ...(origin ? { url: origin + '/', publisher: { '@id': origin + '/#organization' } } : {}) })}</script>`);
    }
    if (article) html = html.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi, (full, open, source, close) => {
        try {
            const data = JSON.parse(source);
            if (data['@type'] !== 'BlogPosting') return full;
            if (image) data.image = image;
            if (origin) data.mainEntityOfPage = origin + pagePath;
            // Publisher is known; an author is not. Do not invent attribution.
            data.publisher = { '@type': 'Organization', name: 'SRK Team Star', ...(origin ? { url: origin } : {}) };
            return open + json(data) + close;
        } catch (_) { return full; }
    });
    if (options.schema) tags.push(`<script type="application/ld+json">${json(options.schema)}</script>`);
    html = html.replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta\b[^>]*(?:name="(?:description|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/gi, '')
        .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, '');
    return html.replace(/<\/head>/i, tags.join('\n') + '\n</head>');
}

function sendHtmlPage(req, res, html, options = {}) {
    const output = renderPageMetadata(html, req.path, options);
    // Exact hashes for the rendered structured data: no unsafe-inline grant and
    // no weakening of the existing per-document payment/map permissions.
    const hashes = [...output.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64') + "'");
    const csp = res.getHeader('Content-Security-Policy');
    if (csp && hashes.length) res.setHeader('Content-Security-Policy', String(csp).replace(/script-src[^;]*/, directive => directive + ' ' + [...new Set(hashes)].join(' ')));
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('html').send(output);
}

module.exports = { siteOrigin, pageFiles, canonicalPath, publicPagePaths, safeImage, sendHtmlPage, renderPageMetadata };
