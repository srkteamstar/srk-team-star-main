'use strict';
// backend/test/commercial-config.test.js
//
// Covers the production-required gate added to core/config/commercial.js.
// GST_RATE and SHIPPING_FREE_ABOVE keep exactly the same fallback VALUES as
// before (0.18 and 50000 — this file has no authority to change the real
// business numbers) for test/development. The only change under test here is
// that NODE_ENV=production (or VERCEL set) now refuses to boot on an unset
// value instead of silently adopting the placeholder.
//
// commercial.js computes GST_RATE/SHIPPING_FREE_ABOVE as top-level consts at
// require time, and it now pulls `isProduction` from core/config/runtime.js
// (itself also computed once at require time) — so exercising this under
// more than one NODE_ENV value means clearing BOTH modules from
// require.cache and re-requiring fresh between cases, the same technique
// test/seo.test.js already uses for products/infrastructure/product.repository
// and test/boot-config.test.js uses for core/config/runtime.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const RUNTIME_PATH = require.resolve('../src/core/config/runtime');
const COMMERCIAL_PATH = require.resolve('../src/core/config/commercial');

function freshCommercial() {
    delete require.cache[RUNTIME_PATH];
    delete require.cache[COMMERCIAL_PATH];
    return require('../src/core/config/commercial');
}

const TOUCHED_KEYS = ['NODE_ENV', 'VERCEL', 'GST_RATE', 'SHIPPING_FREE_ABOVE'];

function withEnv(overrides, fn) {
    const previous = {};
    for (const key of TOUCHED_KEYS) previous[key] = process.env[key];
    try {
        for (const key of TOUCHED_KEYS) delete process.env[key];
        Object.assign(process.env, overrides);
        fn();
    } finally {
        for (const key of TOUCHED_KEYS) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
}

test('production boot refuses an unset GST_RATE', () => {
    withEnv({ NODE_ENV: 'production', SHIPPING_FREE_ABOVE: '50000' }, () => {
        assert.throws(() => freshCommercial(), /GST_RATE must be set explicitly in production/);
    });
});

test('production boot refuses an unset SHIPPING_FREE_ABOVE', () => {
    withEnv({ NODE_ENV: 'production', GST_RATE: '0.18' }, () => {
        assert.throws(() => freshCommercial(), /SHIPPING_FREE_ABOVE must be set explicitly in production/);
    });
});

test('Vercel counts as production for this gate too', () => {
    withEnv({ VERCEL: '1', GST_RATE: '0.18' }, () => {
        assert.throws(() => freshCommercial(), /SHIPPING_FREE_ABOVE must be set explicitly in production/);
    });
});

test('production boot succeeds once both are set explicitly, using the given values exactly', () => {
    withEnv({ NODE_ENV: 'production', GST_RATE: '0.18', SHIPPING_FREE_ABOVE: '75000' }, () => {
        const commercial = freshCommercial();
        assert.equal(commercial.GST_RATE, 0.18);
        assert.equal(commercial.SHIPPING_FREE_ABOVE, 75000);
    });
});

test('an out-of-range value is still refused in production, same as everywhere else', () => {
    withEnv({ NODE_ENV: 'production', GST_RATE: '5', SHIPPING_FREE_ABOVE: '50000' }, () => {
        assert.throws(() => freshCommercial(), /GST_RATE must be a number between/);
    });
});

test('the placeholder fallback values are unchanged and still used outside production', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
        const commercial = freshCommercial();
        assert.equal(commercial.GST_RATE, 0.18);
        assert.equal(commercial.SHIPPING_FREE_ABOVE, 50000);
    });
    withEnv({}, () => { // NODE_ENV unset entirely — the ordinary local/test state
        const commercial = freshCommercial();
        assert.equal(commercial.GST_RATE, 0.18);
        assert.equal(commercial.SHIPPING_FREE_ABOVE, 50000);
    });
});
