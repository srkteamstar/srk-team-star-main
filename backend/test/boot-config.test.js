'use strict';
// backend/test/boot-config.test.js
//
// Covers the SITE_ORIGIN production gate added to
// core/config/runtime.js#assertProductionConfig(). Before this existed, a
// missing or malformed SITE_ORIGIN was never a startup failure: it just made
// core/http/page-metadata.js's siteOrigin() return '' at render time, so
// canonical/og:url tags silently vanished and GET /sitemap.xml silently
// answered 503 — in production, with nothing at boot to say why.
//
// core/config/runtime.js computes `isProduction` ONCE, at require time, from
// process.env.NODE_ENV/VERCEL. To exercise assertProductionConfig() under
// more than one NODE_ENV value in one process, the module has to be cleared
// from require.cache and re-required fresh between cases — the same
// technique test/seo.test.js already uses for
// products/infrastructure/product.repository.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const RUNTIME_PATH = require.resolve('../src/core/config/runtime');

function freshAssertProductionConfig() {
    delete require.cache[RUNTIME_PATH];
    return require('../src/core/config/runtime').assertProductionConfig;
}

// The other fields assertProductionConfig() requires, held valid throughout
// so every case below is isolated to SITE_ORIGIN specifically.
const BASE_ENV = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SESSION_SECRET: 'x'.repeat(48)
};

const TOUCHED_KEYS = ['NODE_ENV', 'VERCEL', 'SITE_ORIGIN', ...Object.keys(BASE_ENV)];

function withEnv(overrides, fn) {
    const previous = {};
    for (const key of TOUCHED_KEYS) previous[key] = process.env[key];
    try {
        for (const key of TOUCHED_KEYS) delete process.env[key];
        Object.assign(process.env, BASE_ENV, overrides);
        fn();
    } finally {
        for (const key of TOUCHED_KEYS) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
}

test('production boot refuses an absent SITE_ORIGIN', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
        assert.throws(() => freshAssertProductionConfig()(), /SITE_ORIGIN must be a confirmed HTTPS origin/);
    });
});

test('production boot refuses every malformed SITE_ORIGIN shape', () => {
    const bad = [
        'http://store.example',                 // not HTTPS
        'https://store.example/sub',             // extra path
        'https://store.example/?x=1',            // query string
        'https://store.example/#frag',           // fragment
        'https://user:pass@store.example',       // userinfo
        'https://localhost',                     // never the real public origin
        'https://127.0.0.1',
        'not-a-url'
    ];
    for (const value of bad) {
        withEnv({ NODE_ENV: 'production', SITE_ORIGIN: value }, () => {
            assert.throws(
                () => freshAssertProductionConfig()(),
                /SITE_ORIGIN must be a confirmed HTTPS origin/,
                `expected SITE_ORIGIN=${value} to be refused`
            );
        });
    }
});

test('production boot accepts a confirmed HTTPS origin with no path', () => {
    withEnv({ NODE_ENV: 'production', SITE_ORIGIN: 'https://www.srkteamstar.com' }, () => {
        assert.doesNotThrow(() => freshAssertProductionConfig()());
    });
});

test('Vercel counts as production for this gate too', () => {
    withEnv({ VERCEL: '1', SITE_ORIGIN: '' }, () => {
        assert.throws(() => freshAssertProductionConfig()(), /SITE_ORIGIN must be a confirmed HTTPS origin/);
    });
});

test('SITE_ORIGIN stays optional outside production, unchanged from before', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
        assert.doesNotThrow(() => freshAssertProductionConfig()());
    });
    withEnv({ NODE_ENV: 'test' }, () => {
        assert.doesNotThrow(() => freshAssertProductionConfig()());
    });
    withEnv({}, () => { // NODE_ENV unset entirely
        assert.doesNotThrow(() => freshAssertProductionConfig()());
    });
});
