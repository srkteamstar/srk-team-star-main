#!/usr/bin/env node
'use strict';

// Deliberate allowlist, not an asset-folder conversion. Remote image URLs and
// existing AVIF files never enter this build; original files are never changed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require(process.env.SRK_SHARP_MODULE || 'sharp');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public/assets/optimized');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sources = [
    ['hero-image.png', [480, 800, 1280, 1600]],
    ['machine-card-desktop.png', [320, 415]],
    ['frame-molding-desktop.png', [480, 800, 1280]],
    ['hardware-card-desktop.png', [320, 415]],
    ['hardware-hero-desktop.png', [480, 800, 1280]],
    ['frame-molding-card-desktop.png', [320, 415]],
    ['icons/SRK-Team-Star-Logos/primary-bgless.png', [160, 320, 480]],
    ['icons/SRK-Team-Star-Logos/primary.png', [48], 'png']
];

async function main() {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const manifest = {};
    for (const [relative, widths, format = 'webp'] of sources) {
        const original = fs.readFileSync(path.join(ROOT, 'public/assets', relative));
        const metadata = await sharp(original).metadata();
        const name = path.basename(relative, path.extname(relative));
        const variants = [];
        for (const width of [...new Set(widths.map(value => Math.min(value, metadata.width)))]) {
            const pipeline = sharp(original).rotate().resize({ width, withoutEnlargement: true });
            const { data, info } = await (format === 'png'
                ? pipeline.png({ compressionLevel: 9 })
                : pipeline.webp({ quality: 84, alphaQuality: 100, effort: 6 }))
                .toBuffer({ resolveWithObject: true });
            const hash = digest(data);
            const filename = `${name}-${info.width}.${hash.slice(0, 16)}.${format}`;
            const destination = path.join(OUTPUT, filename);
            if (!fs.existsSync(destination)) fs.writeFileSync(destination, data);
            variants.push({ url: '/assets/optimized/' + filename, width: info.width,
                height: info.height, bytes: data.length, sha256: hash });
        }
        manifest['/assets/' + relative] = { originalBytes: original.length,
            originalSha256: digest(original), width: metadata.width, height: metadata.height, variants };
        console.log(`${relative}: ${original.length} bytes -> ${variants.map(v => `${v.width}px / ${v.bytes} bytes`).join(', ')}`);
    }
    fs.writeFileSync(path.join(__dirname, 'local-image-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
