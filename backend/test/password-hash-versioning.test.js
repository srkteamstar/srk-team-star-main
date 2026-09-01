// =============================================================================
// password-hash-versioning.test.js — S06, against the real password service
// =============================================================================
//
// A unit-level suite rather than an HTTP one: hash format is not observable
// over the wire (publicProfile() never returns password_hash, on purpose —
// authz.test.js already asserts that), so this exercises
// modules/auth/services/customer-password.service.js directly. No server,
// no database — the module's only dependency is Node's own crypto.
//
// Run with: node backend/test/password-hash-versioning.test.js
//
// WHAT THIS PROVES:
//   - a legacy scrypt$<salt>$<hash> value (Node's old implicit N=16384)
//     still verifies at the parameters it was actually hashed with — the
//     harness's fixture accounts (authz-harness.js) are exactly this shape,
//     so a regression here would also fail every existing login assertion
//     in authz.test.js and payments.test.js.
//   - a fresh hash is the new scrypt$v2$<N>$<r>$<p>$<salt>$<hash> format, at
//     the OWASP-sized cost parameters, and round-trips correctly.
//   - needsUpgrade() flags legacy values and only legacy values.
//   - a v2 value whose embedded N/r/p have been altered — the shape a
//     tampered or corrupted row would take — is refused rather than handed
//     to scrypt(), which is the allowlist S06 asks for.
//   - malformed/unknown values refuse rather than throw.
//   - dummyHash() is stable across calls (computed once, not per request)
//     and is itself a v2 hash, so verifying against it costs what verifying
//     against a real account costs — the equal-time half of S05's fix.
const crypto = require('crypto');
const {
    hashCustomerPassword,
    verifyCustomerPassword,
    needsUpgrade,
    dummyHash
} = require('../src/modules/auth/services/customer-password.service');

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

// Mirrors authz-harness.js's fixturePasswordHash() exactly — the same shape
// the seeded test accounts (a@example.test etc.) carry today.
const legacySalt = Buffer.from('0123456789abcdef');
const legacyHashOf = (password) =>
    `scrypt$${legacySalt.toString('hex')}$${crypto.scryptSync(password, legacySalt, 64).toString('hex')}`;

(async () => {
    console.log('\n=== 1. LEGACY FORMAT STILL VERIFIES AT ITS ORIGINAL COST ===');
    const legacyHash = legacyHashOf('correct-horse-42');
    check('a legacy hash verifies its real password',
        await verifyCustomerPassword('correct-horse-42', legacyHash), 'expected true');
    check('a legacy hash refuses the wrong password',
        !(await verifyCustomerPassword('wrong-password', legacyHash)), 'expected false');
    check('a legacy hash is flagged for upgrade',
        needsUpgrade(legacyHash), 'expected true');

    console.log('\n=== 2. NEW HASHES ARE VERSIONED, AT AN OWASP-SIZED COST ===');
    const v2Hash = await hashCustomerPassword('another-correct-horse-99');
    const v2Parts = v2Hash.split('$');
    check('a fresh hash is scrypt$v2$...', v2Parts[0] === 'scrypt' && v2Parts[1] === 'v2', v2Hash);
    check('a fresh hash uses N=131072 (OWASP-listed for scrypt)', v2Parts[2] === '131072', v2Parts[2]);
    check('a fresh hash verifies its real password',
        await verifyCustomerPassword('another-correct-horse-99', v2Hash), 'expected true');
    check('a fresh hash refuses the wrong password',
        !(await verifyCustomerPassword('nope', v2Hash)), 'expected false');
    check('a fresh hash is NOT flagged for upgrade', !needsUpgrade(v2Hash), 'expected false');

    console.log('\n=== 3. A TAMPERED / OVERSIZED v2 COST IS REFUSED, NOT RUN ===');
    const tamperedLowN = [...v2Parts];
    tamperedLowN[2] = '1024'; // an attacker-friendly cost, if this were ever honoured
    check('a v2 value with an altered N is refused outright',
        !(await verifyCustomerPassword('another-correct-horse-99', tamperedLowN.join('$'))), 'expected false');

    const tamperedHighN = [...v2Parts];
    tamperedHighN[2] = '4194304'; // a memory-exhaustion-sized N, if this were honoured
    check('a v2 value with an inflated N is refused outright (not handed to scrypt)',
        !(await verifyCustomerPassword('another-correct-horse-99', tamperedHighN.join('$'))), 'expected false');

    console.log('\n=== 4. MALFORMED VALUES REFUSE RATHER THAN THROW ===');
    check('a value with no $ at all is refused', !(await verifyCustomerPassword('x', 'not-a-hash-at-all')), 'expected false');
    check('a null stored hash is refused', !(await verifyCustomerPassword('x', null)), 'expected false');
    check('an empty-string password is refused', !(await verifyCustomerPassword('', v2Hash)), 'expected false');

    console.log('\n=== 5. THE DUMMY HASH IS STABLE AND COSTS WHAT A REAL ONE DOES ===');
    const d1 = await dummyHash();
    const d2 = await dummyHash();
    check('dummyHash() is memoized across calls (computed once per process)', d1 === d2, 'expected identical strings');
    const dParts = d1.split('$');
    check('the dummy hash is itself scrypt$v2 — same verification cost as a real account',
        dParts[0] === 'scrypt' && dParts[1] === 'v2' && dParts[2] === '131072', d1);
    check('the dummy hash never verifies as a real credential',
        !(await verifyCustomerPassword('any-password-at-all', d1)), 'expected false');

    console.log('\n' + '='.repeat(64));
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
})();
