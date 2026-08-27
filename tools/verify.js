#!/usr/bin/env node
/*
 * tools/verify.js — the three structural checks, in one command
 * ============================================================================
 *
 * These answer the question the restructure has to keep answering: "is
 * everything still wired to everything it was wired to?" They are fast (about
 * a second, no network, no database) and they are the checks to run after
 * moving or renaming ANY file in this project, front or back.
 *
 *   verify-links       every href/src in every page and every browser module
 *                      resolves through the same mount table the server uses
 *   verify-boundaries  no module reaches past a sibling's published interface,
 *                      shared/ imports nothing, core/ imports no module,
 *                      and there are no barrel files
 *   verify-boot        every file under backend/src/ loads, and the assembled
 *                      route table matches what `#1` served, both ways
 *
 * They run in that order on purpose: cheapest and most likely to catch a
 * careless move first, so a broken script tag is reported in a second rather
 * than after a boot.
 *
 * ALL THREE RUN EVEN IF ONE FAILS. A verifier that stops at the first failure
 * makes you fix and re-run three times to see three problems that were all
 * introduced by the same edit.
 *
 * Run:  npm run verify            (from backend/)
 *       node tools/verify.js      (from the project root)
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const CHECKS = ['verify-links.js', 'verify-boundaries.js', 'verify-boot.js'];

let failed = 0;

for (const check of CHECKS) {
    console.log(`\n──── ${check} ${'─'.repeat(Math.max(0, 60 - check.length))}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, check)], {
        stdio: 'inherit'
    });
    if (result.status !== 0) failed++;
}

console.log('\n' + '='.repeat(72));
if (failed) {
    console.error(`VERIFY: ${failed} of ${CHECKS.length} check(s) FAILED.`);
    process.exit(1);
}
console.log(`VERIFY: all ${CHECKS.length} checks passed.`);
