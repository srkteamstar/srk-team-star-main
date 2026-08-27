#!/usr/bin/env node
/*
 * tools/verify-boot.js — every file loads, and the API surface is unchanged
 * ============================================================================
 *
 * TWO CHECKS, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 * 1. EVERY FILE UNDER backend/src/ IS REQUIRED.
 *    A file nothing happens to import yet is a file whose missing `require`
 *    nobody finds until the first request reaches it — which, for a webhook,
 *    can be weeks. Loading all of them makes that a boot failure instead.
 *
 * 2. THE ASSEMBLED APP IS COMPARED AGAINST tools/api-surface.json.
 *
 *    The comparison runs BOTH WAYS. A missing route fails, and so does an
 *    unexpected one — a module registered twice, a path that drifted by a
 *    character, or a route somebody added without saying so, as surely as one
 *    that vanished.
 *
 * WHY THIS AND NOT JUST THE TEST SUITES. `npm test` proves the routes it
 * exercises behave; it cannot notice that a route nobody wrote a test for has
 * stopped existing. This is the cheap, total check that sits under them.
 *
 * IT NEVER LISTENS AND IT NEVER TOUCHES SUPABASE. main.js exports createApp()
 * separately from start() for exactly this: the app is assembled, inspected,
 * and thrown away.
 *
 * Run:  node tools/verify-boot.js          (or: npm run verify:boot)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const SRC = path.join(BACKEND, 'src');

// The environment the modules read at require time. Real values are not needed
// and are deliberately not used: this must be runnable on a machine with no
// .env at all, and must never reach the live project.
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'verify-boot-session-secret-32-chars-min';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://verify-boot.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'verify-boot';

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/*
 * READING THE ROUTE TABLE BACK OUT OF EXPRESS.
 *
 * Express 5 does not keep a mount path on the layer as a readable string - it
 * compiles one into a matcher function - so the prefix a router was mounted at
 * cannot be recovered by inspecting the stack afterwards. Rather than parse a
 * compiled regexp and depend on an internal shape, the mount is RECORDED as it
 * happens: app.use is wrapped for the duration of the assembly, and the router
 * handle is remembered against the path it was given.
 *
 * This is the one place in this project that reaches into a framework's
 * internals, and it is confined to a verifier rather than to anything that
 * serves a request.
 */
const express = require(path.join(BACKEND, 'node_modules', 'express'));

const mountedAt = new Map();
const originalUse = express.application.use;
express.application.use = function patchedUse(...args) {
    if (typeof args[0] === 'string') {
        for (const handler of args.slice(1)) {
            if (typeof handler === 'function') mountedAt.set(handler, args[0] === '/' ? '' : args[0]);
        }
    }
    return originalUse.apply(this, args);
};

/**
 * The label a non-literal route is reported under. It has to match the key in
 * api-surface.json's `inherited_non_literal`, so the six policy pages are
 * described the way a person would describe them rather than by the source of
 * a regular expression.
 */
function labelFor(routePath) {
    if (typeof routePath === 'string') return routePath;
    if (routePath instanceof RegExp && /legal/.test(routePath.source)) return '/legal/<policy>.html';
    return String(routePath);
}

/** Walk an Express app or router stack and collect "VERB /path" strings. */
function routesOf(app) {
    const found = new Set();

    const visit = (stack, prefix) => {
        for (const layer of stack || []) {
            if (layer.route) {
                const label = labelFor(layer.route.path);
                const p = typeof layer.route.path === 'string' ? prefix + layer.route.path : label;
                const methods = layer.route.methods
                    || (layer.route.stack || []).reduce((acc, s) => (s.method ? Object.assign(acc, { [s.method]: true }) : acc), {});
                for (const method of Object.keys(methods)) {
                    if (methods[method]) found.add(`${method.toUpperCase()} ${p}`);
                }
            } else if (layer.handle && layer.handle.stack) {
                visit(layer.handle.stack, prefix + (mountedAt.get(layer.handle) || ''));
            }
        }
    };

    const stack = (app.router && app.router.stack) || (app._router && app._router.stack);
    if (!stack) throw new Error('Could not read the router stack - Express internals changed.');
    visit(stack, '');
    return found;
}

function main() {
    // ---- 1. every file loads -----------------------------------------------
    const files = walk(SRC, []);
    const failures = [];
    for (const file of files) {
        try {
            require(file);
        } catch (error) {
            failures.push({ file: path.relative(ROOT, file), error });
        }
    }

    if (failures.length) {
        console.error('\nFILES THAT DO NOT LOAD\n');
        for (const f of failures) {
            console.error(`  ${f.file}`);
            console.error(`      ${f.error && f.error.message}\n`);
        }
        console.error(`${failures.length} file(s) failed to load.`);
        process.exit(1);
    }
    console.log(`verify-boot: ${files.length} file(s) under backend/src/ loaded.`);

    // ---- 2. the API surface -------------------------------------------------
    const { createApp } = require(path.join(SRC, 'main'));
    const app = createApp();
    const actual = routesOf(app);

    const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'api-surface.json'), 'utf8'));
    const expected = new Set(
        contract.routes
            .concat(contract.operational)
            .concat(Object.keys(contract.non_literal))
    );

    const missing = [...expected].filter(r => !actual.has(r)).sort();
    const unexpected = [...actual].filter(r => !expected.has(r)).sort();

    console.log(`verify-boot: ${actual.size} route(s) exposed; ${contract.routes.length} API, ${Object.keys(contract.non_literal).length} non-literal, ${contract.operational.length} operational.`);

    if (missing.length || unexpected.length) {
        if (missing.length) {
            console.error('\nROUTES #1 SERVED AND #2 DOES NOT\n');
            missing.forEach(r => console.error('  - ' + r));
        }
        if (unexpected.length) {
            console.error('\nROUTES #2 SERVES THAT THE CONTRACT DOES NOT LIST\n');
            unexpected.forEach(r => console.error('  + ' + r));
            console.error('\n  If one of these is deliberate, add it to tools/api-surface.json');
            console.error('  with a reason in the file, not silently.');
        }
        console.error('');
        process.exit(1);
    }

    console.log('verify-boot: OK — the API surface matches the contract exactly.');
}

main();
