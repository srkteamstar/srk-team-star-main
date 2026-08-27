#!/usr/bin/env node
/*
 * tools/verify-boundaries.js — the module boundaries, enforced rather than agreed
 * ============================================================================
 *
 * A FOLDER STRUCTURE IS A SUGGESTION UNTIL SOMETHING FAILS THE BUILD OVER IT.
 * That is the doctrine's own point: "enforce strict dependency rules via
 * linting", not by convention. `#1` had no boundaries to break; `#2` has them,
 * and the way they erode is one reasonable-looking `require('../../orders/…')`
 * at a time, each of which works.
 *
 * THE FOUR RULES
 *
 *   1. shared/ imports NOTHING from this project.
 *      A shared utility that needs to know about orders is not shared — it is
 *      a domain service wearing a utility's hat. Node built-ins and npm
 *      packages are fine; a relative import out of shared/ is not.
 *
 *   2. core/ never imports a module.
 *      core/ is the infrastructure every module stands on. The day it reaches
 *      back into one, the dependency graph has a cycle in it and the boot
 *      order starts to matter.
 *
 *   3. A module imports a sibling ONLY through that sibling's .public.js.
 *      This is the rule with teeth. modules/checkout may hold
 *      modules/products/products.public.js; it may not hold
 *      modules/products/infrastructure/product.repository.js, even though the
 *      second one works perfectly and is one character shorter to type.
 *
 *   4. No barrel files.
 *      No index.js whose job is re-exporting a directory. The doctrine names
 *      three costs — circular dependencies that surface as "Cannot access 'X'
 *      before initialization", evaluating every file in a folder to import one
 *      symbol, and defeated tree-shaking. A .public.js is NOT a barrel: it is a
 *      deliberately narrow, hand-written interface, and it is the only file in
 *      a module a sibling may name.
 *
 * Run:  node tools/verify-boundaries.js     (or: npm run verify:boundaries)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'backend', 'src');

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/** Which layer a file belongs to, and which module if any. */
function classify(file) {
    const rel = path.relative(SRC, file).split(path.sep);
    if (rel[0] === 'shared') return { layer: 'shared' };
    if (rel[0] === 'core') return { layer: 'core' };
    if (rel[0] === 'modules') return { layer: 'module', module: rel[1] };
    return { layer: 'root' };          // main.js
}

const REQUIRE = /require\(\s*'([^']+)'\s*\)/g;

function requiresIn(file) {
    const source = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const out = [];
    let m;
    while ((m = REQUIRE.exec(source)) !== null) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;      // npm package or node built-in
        out.push({
            spec,
            line: source.slice(0, m.index).split('\n').length,
            target: path.resolve(path.dirname(file), spec)
        });
    }
    return out;
}

function main() {
    const files = walk(SRC, []);
    const problems = [];
    let edges = 0;

    for (const file of files) {
        const from = classify(file);
        const shown = path.relative(ROOT, file);

        // Rule 4 — barrels.
        if (path.basename(file) === 'index.js') {
            problems.push({
                file: shown, line: 1,
                why: 'barrel file — re-exporting a directory is banned in application code; '
                   + 'import the file you need by its own path, or publish a narrow <module>.public.js'
            });
        }

        for (const req of requiresIn(file)) {
            edges++;
            const to = classify(req.target);

            // Rule 1 — shared/ is a leaf.
            if (from.layer === 'shared') {
                if (!req.target.startsWith(path.join(SRC, 'shared'))) {
                    problems.push({
                        file: shown, line: req.line,
                        why: `shared/ imported "${req.spec}". shared/ must import nothing from this `
                           + 'project: a utility that needs a module is a domain service, and belongs in it'
                    });
                }
                continue;
            }

            // Rule 2 — core/ never depends on a module.
            if (from.layer === 'core' && to.layer === 'module') {
                problems.push({
                    file: shown, line: req.line,
                    why: `core/ imported modules/${to.module}. core/ is what every module stands on; `
                       + 'reaching back into one puts a cycle in the graph'
                });
                continue;
            }

            // Rule 3 — a module reaches a sibling only through its .public.js.
            if (from.layer === 'module' && to.layer === 'module' && to.module !== from.module) {
                const publicFile = path.join(SRC, 'modules', to.module, `${to.module}.public.js`);
                const resolved = req.target.endsWith('.js') ? req.target : req.target + '.js';
                if (resolved !== publicFile) {
                    problems.push({
                        file: shown, line: req.line,
                        why: `modules/${from.module} reached into modules/${to.module} at "${req.spec}". `
                           + `A sibling is reachable only through modules/${to.module}/${to.module}.public.js`
                    });
                }
            }
        }
    }

    console.log(`verify-boundaries: ${files.length} file(s), ${edges} internal import(s) checked.`);

    if (problems.length) {
        console.error('\nBOUNDARY VIOLATIONS\n');
        for (const p of problems) {
            console.error(`  ${p.file}:${p.line}`);
            console.error(`      ${p.why}\n`);
        }
        console.error(`${problems.length} violation(s).`);
        process.exit(1);
    }

    // The cross-module edges are few enough to be worth printing in full: the
    // whole claim of this architecture is that they are countable.
    const crossings = [];
    for (const file of files) {
        const from = classify(file);
        if (from.layer !== 'module') continue;
        for (const req of requiresIn(file)) {
            const to = classify(req.target);
            if (to.layer === 'module' && to.module !== from.module) {
                crossings.push(`${from.module} -> ${to.module}`);
            }
        }
    }
    const unique = [...new Set(crossings)].sort();
    console.log(`verify-boundaries: OK — ${unique.length} cross-module edge(s), all through a published interface:`);
    unique.forEach(edge => console.log(`    ${edge}`));
}

main();
