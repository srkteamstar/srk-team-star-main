/*
 * Vercel discovers static files before an Express build command runs, so the
 * deployable asset tree must already be committed under root public/. This
 * check keeps a dashboard-level build-command override harmless and fails with
 * a useful error if the required source layout is ever broken.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const required = [
    'public/assets/vendor/tailwind.build.css',
    'public/assets/vendor/lenis-1.1.18.min.js',
    'public/js',
    'public/robots.txt'
];

for (const relative of required) {
    if (!fs.existsSync(path.join(projectRoot, relative))) {
        throw new Error(`Missing committed Vercel static source: ${relative}`);
    }
}

console.log('Vercel static source is present under public/.');
