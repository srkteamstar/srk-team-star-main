#!/usr/bin/env node
'use strict';

// A deterministic, mechanical asset build. Source JS/CSS stays in its original
// module; only generated copies get immutable URLs. Re-run after source edits.
// --check verifies without writing. Never deletes originals or older versions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CHECK = process.argv.includes('--check');
const imageManifest = require('./local-image-manifest.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assets = new Map();
const issues = [];
const descriptions = {
    'frontend/pages/about.html': 'Learn about SRK Team Star and our machinery, materials and support for professional picture-frame manufacturing.',
    'frontend/pages/catalogue.html': 'Browse SRK Team Star frame-making machinery, mouldings and hardware. Explore product specifications and request a quotation.',
    'frontend/pages/contact.html': 'Contact SRK Team Star for frame-making machinery, product enquiries, quotations and manufacturing support.',
    'frontend/pages/store/store.html': 'Shop SRK Team Star machinery, frame mouldings, hardware and accessories for professional frame manufacturing.'
};
const criticalFonts = ['Jqz55SSPQuCQF3t8uOwiUL-taUTtap9Gayo.woff2', 'xn7gYHE41ni1AdIRggexSg.woff2'];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

function writeGenerated(file, bytes) {
    if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(bytes))) return;
    if (CHECK) { issues.push('Missing or stale generated file: ' + path.relative(ROOT, file)); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
}

function sourceFile(url) {
    if (!/^\/(?:assets|js)\//.test(url) || url.includes('?') || url.includes('#')) throw new Error('Not a local source: ' + url);
    const target = path.resolve(PUBLIC, '.' + decodeURIComponent(url));
    if (!target.startsWith(PUBLIC + path.sep)) throw new Error('Asset escapes public directory');
    return target;
}

function version(url) {
    if (assets.has(url)) return assets.get(url);
    let bytes = fs.readFileSync(sourceFile(url));
    // Source checkout line endings may differ on Windows and Linux. Hash and
    // publish the same bytes on both hosts so deploy-time verification is stable.
    if (/\.(?:css|js)$/.test(url)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n'));
    if (url.endsWith('.css')) {
        // Local fonts stay local. Absolute hashed URLs also make copied CSS
        // independent of its new directory; external/data URLs are untouched.
        bytes = Buffer.from(bytes.toString('utf8').replace(/url\(([^)]+)\)/g, (full, raw) => {
            const resource = raw.trim().replace(/^['"]|['"]$/g, '');
            if (/^(?:data:|https?:|#)/.test(resource)) return full;
            const local = path.posix.normalize(path.posix.join(path.posix.dirname(url), resource));
            return `url("${version(resource.startsWith('/') ? resource : local)}")`;
        }));
    }
    const hash = digest(bytes).slice(0, 16);
    const generatedUrl = `/assets/versioned/${hash}/${path.posix.basename(url)}`;
    writeGenerated(sourceFile(generatedUrl), bytes);
    assets.set(url, generatedUrl);
    return generatedUrl;
}

function attribute(tag, key, value) {
    const pattern = new RegExp(`\\s${key}="[^"]*"`);
    const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    if (pattern.test(tag)) return tag.replace(pattern, ` ${key}="${escaped}"`);
    return tag.replace(/\s*\/?>$/, ending => ` ${key}="${escaped}"${ending}`);
}

function improveImage(tag) {
    const match = tag.match(/\bdata-local-image="([^"]+)"/) || tag.match(/\bsrc="([^"]+)"/);
    if (!match) return tag;
    let url;
    try { url = decodeURIComponent(match[1]); } catch (_) { return tag; }
    const item = imageManifest[url];
    if (item && !url.endsWith('/primary.png')) {
        const largest = item.variants[item.variants.length - 1];
        const logo = url.includes('/icons/');
        tag = attribute(tag, 'data-local-image', url);
        tag = attribute(tag, 'src', largest.url);
        tag = attribute(tag, 'srcset', item.variants.map(v => `${v.url} ${v.width}w`).join(', '));
        const sizes = logo ? '200px' : tag.includes('aspect-[16/8]')
            ? '(min-width: 1152px) 1104px, calc(100vw - 48px)'
            : tag.includes('lg:h-full') ? '(min-width: 1024px) 650px, calc(100vw - 48px)'
            : '(min-width: 1024px) 400px, (min-width: 768px) 50vw, calc(100vw - 48px)';
        tag = attribute(tag, 'sizes', sizes);
        tag = attribute(tag, 'width', String(item.width));
        tag = attribute(tag, 'height', String(item.height));
        tag = attribute(tag, 'decoding', 'async');
        if (!logo && !/\bloading=/.test(tag)) tag = attribute(tag, 'loading', 'lazy');
    }
    // Leave already-optimised local AVIF files in their original format.
    if (url.startsWith('/assets/') && /\.avif$/i.test(url) && !url.includes('/icons/')) {
        if (!/\bloading=/.test(tag)) tag = attribute(tag, 'loading', 'lazy');
        if (!/\bdecoding=/.test(tag)) tag = attribute(tag, 'decoding', 'async');
    }
    return tag;
}

for (const [url, image] of Object.entries(imageManifest)) {
    if (digest(fs.readFileSync(sourceFile(url))) !== image.originalSha256) issues.push('Image source changed; rebuild images: ' + url);
    for (const variant of image.variants) {
        if (!fs.existsSync(sourceFile(variant.url)) || digest(fs.readFileSync(sourceFile(variant.url))) !== variant.sha256) issues.push('Missing or changed image variant: ' + variant.url);
    }
}

let changed = 0;
const documents = [...walk(path.join(ROOT, 'frontend/pages')), ...walk(path.join(ROOT, 'backend/templates'))].filter(file => file.endsWith('.html'));
for (const file of documents) {
    const original = fs.readFileSync(file, 'utf8');
    let html = original.replace(/<img\b[^>]*>/g, improveImage);
    // A bypass link and readable catalogue access also work without JavaScript.
    if (!html.includes('class="srk-skip-link"')) {
        const main = html.match(/<main\b[^>]*>/);
        if (main) {
            const mainId = (main[0].match(/\bid="([^"]+)"/) || [])[1] || 'srk-main-content';
            if (!/\bid=/.test(main[0])) html = html.replace(main[0], attribute(main[0], 'id', mainId));
            html = html.replace(/<body\b[^>]*>/, body => body + `\n<a class="srk-skip-link" href="#${mainId}">Skip to content</a>`);
        }
    }
    if (/data-srk-page="(?:store|catalogue)"/.test(html) && !html.includes('data-no-js-catalogue')) {
        html = html.replace(/<main\b[^>]*>/, main => main + '\n<noscript data-no-js-catalogue><p class="p-6"><a href="/products/">Browse our accessible product catalogue</a>. The interactive store requires JavaScript for purchases and quotations.</p></noscript>');
    }
    html = html.replace(/<h[45]([^>]*>Our Manufacturing Plant)<\/h[45]>/g, '<h3$1</h3>')
        .replace(/<h6\b/g, '<h2').replace(/<\/h6>/g, '</h2>')
        .replace(/alt="Machine-card"/g, 'alt="Trim Craft frame-cutting machine"')
        .replace(/alt="Moulding-card"/g, 'alt="Frame moulding profiles"')
        .replace(/alt="Hardware-card"/g, 'alt="Frame-making hardware"');
    if (file.endsWith('legal-shell.html')) html = html.replace(/<h4([^>]*>[\s\S]*?SRK Team Star[\s\S]*?)<\/h4>/, '<p$1</p>');
    let gradientIndex = 0;
    html = html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, svg => {
        if (!svg.includes('id="srk-fade-')) return svg;
        gradientIndex++;
        return svg.replace(/srk-fade-(left|right)(?=["\)])/g, 'srk-divider-' + gradientIndex + '-$1');
    });
    const relatedHeading = /(<h2[^>]*>(?:Related workshop insights|More from the workshop)<\/h2>)/;
    if (relatedHeading.test(html)) {
        const split = html.split(relatedHeading);
        split[2] = split[2].replace(/(<article\b[\s\S]*?<\/article>)/g, article => article.replace(/<h2\b/g, '<h3').replace(/<\/h2>/g, '</h3>'));
        html = split.join('');
    }
    const enquiryLabels = { 'form-name': 'Name', 'form-company': 'Company', 'form-email': 'Email', 'form-phone': 'Phone Number', 'form-message': 'Your Message' };
    html = html.replace(/<label\b[^>]*for="form-(?:name|company|email|phone|message)"[^>]*>/g, tag => attribute(tag, 'class', 'srk-enquiry-label'));
    html = html.replace(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/g, field => {
        const id = field.match(/\bid="(form-(?:name|company|email|phone|message))"/);
        if (!id || html.includes(`for="${id[1]}"`)) return field;
        return `<div class="srk-enquiry-field"><label class="srk-enquiry-label" for="${id[1]}">${enquiryLabels[id[1]]} <small>(${/\brequired\b/.test(field) ? 'required' : 'optional'})</small></label>${field}</div>`;
    });
    const description = descriptions[path.relative(ROOT, file).split(path.sep).join('/')];
    if (description && !/<meta\s+name="description"/i.test(html)) {
        html = html.replace(/<\/title>/, `</title>\n    <meta name="description" content="${description}">`);
    }
    if (html.includes('/assets/vendor/fonts/fonts.css')) {
        const preloads = criticalFonts.filter(font => !html.includes(`as="font" data-critical-font="${font}"`))
            .map(font => `    <link rel="preload" href="/assets/vendor/fonts/${font}" as="font" data-critical-font="${font}" type="font/woff2" crossorigin="anonymous">`).join('\n');
        if (preloads) html = html.replace(/<\/title>/, '</title>\n' + preloads);
    }
    // Preserve parser-time scripts on checkout/store and any document with an
    // inline JS dependency. On external-only pages, defer ALL scripts in their
    // original order, including the final view-state restoration module.
    const hasInlineJS = /<script\b(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html);
    if (!hasInlineJS) html = html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g, tag => /\b(?:defer|async)\b/.test(tag) ? tag : tag.replace('<script', '<script defer'));
    html = html.replace(/<a\b[^>]*href="https:\/\/wa\.me\/[^"\s]+"[^>]*>/g, tag =>
        tag.includes('fixed ') && !tag.includes('aria-label=') ? attribute(tag, 'aria-label', 'Chat with SRK Team Star on WhatsApp') : tag);
    // Give placeholder-only enquiry fields persistent accessible names. Keep
    // existing explicit labels, field ids, validation and submission unchanged.
    html = html.replace(/<(?:input|textarea)\b[^>]*>/g, tag => {
        const id = tag.match(/\bid="(form-(?:name|company|email|phone|message))"/);
        if (!id || /aria-label(?:ledby)?=/.test(tag) || html.includes(`for="${id[1]}"`)) return tag;
        const labels = { 'form-name': 'Name', 'form-company': 'Company', 'form-email': 'Email', 'form-phone': 'Phone Number', 'form-message': 'Your Message' };
        return attribute(tag, 'aria-label', labels[id[1]]);
    });
    html = html.replace(/<(?:script|link)\b[^>]*>/g, tag => {
        const source = tag.match(/\bdata-asset-source="([^"]+)"/);
        const field = tag.startsWith('<script') ? 'src' : 'href';
        const current = tag.match(new RegExp(`\\b${field}="([^"]+)"`));
        if (!current) return tag;
        const url = source ? source[1] : current[1];
        if (url === '/assets/icons/SRK-Team-Star-Logos/primary.png') {
            tag = attribute(tag, 'data-asset-source', url);
            tag = attribute(tag, field, imageManifest[url].variants[0].url);
            return attribute(tag, 'type', 'image/png');
        }
        if (!/^\/(?:assets|js)\/.+\.(?:css|js|woff2)$/.test(url) || url.startsWith('/assets/versioned/')) return tag;
        tag = attribute(tag, 'data-asset-source', url);
        return attribute(tag, field, version(url));
    });
    if (html !== original) {
        changed++;
        if (CHECK) issues.push('Stale asset references: ' + path.relative(ROOT, file));
        else fs.writeFileSync(file, html);
    }
}
const map = Object.fromEntries([...assets].sort(([a], [b]) => a.localeCompare(b)));
writeGenerated(path.join(__dirname, 'web-assets-manifest.json'), JSON.stringify(map, null, 2) + '\n');
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log(`${CHECK ? 'Verified' : 'Built'} ${assets.size} versioned assets and local image variants across ${documents.length} documents; ${changed} document(s) ${CHECK ? 'need updates' : 'updated'}.`);
