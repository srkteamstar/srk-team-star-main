// =============================================================================
// account-throttle-key.test.js — S05's account-keyed throttle, unit-level
// =============================================================================
//
// Why unit-level rather than through the HTTP harness: exercising
// accountLoginLimiter's actual 429 over HTTP would mean sending enough failed
// logins to trip it, and authLimiter — the existing per-IP limiter — shares
// the same 15-minute budget with every login and register call the harness
// server sees for the rest of its process lifetime, across BOTH authz.test.js
// and payments.test.js. Deliberately exhausting one limiter over HTTP would
// exhaust the other and fail unrelated, later tests for a reason that has
// nothing to do with them. accountThrottleKey() — the part actually new here
// — is a pure function and is what this proves correct instead: that it
// normalizes an identifier the same way login resolution does, differs
// between accounts, and never puts the identifier itself in the key it
// hands the rate limiter's store.
//
// Run with: node backend/test/account-throttle-key.test.js
const REQUIRED_ENV = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
    SESSION_SECRET: 'a-standalone-test-session-secret-at-least-32-chars'
};
for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    if (!process.env[key]) process.env[key] = value;
}

const { accountThrottleKey } = require('../src/modules/auth/infrastructure/auth-rate-limit');

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

const reqWith = (identifier) => ({ body: { identifier } });

console.log('\n=== ACCOUNT THROTTLE KEY ===');

const emailKey = accountThrottleKey(reqWith('a@example.test'));
const emailKeyDifferentCaseAndSpace = accountThrottleKey(reqWith('  A@Example.Test  '));
check('the same email normalizes to the same key regardless of case or whitespace',
    emailKey === emailKeyDifferentCaseAndSpace, `${emailKey} vs ${emailKeyDifferentCaseAndSpace}`);

const otherEmailKey = accountThrottleKey(reqWith('b@example.test'));
check('a different account gets a different key', emailKey !== otherEmailKey, emailKey);

const phoneKey = accountThrottleKey(reqWith('+91 89015 03544'));
const phoneKeyDigitsOnly = accountThrottleKey(reqWith('8901503544'));
check('a phone identifier normalizes the same way resolveIdentifier() does (digits only)',
    phoneKey === phoneKeyDigitsOnly, `${phoneKey} vs ${phoneKeyDigitsOnly}`);

check('the key is never the identifier itself',
    !emailKey.includes('example') && !emailKey.toLowerCase().includes('a@'), emailKey);
check('the key looks like an HMAC digest (fixed-length hex), not a raw or reversible value',
    /^[0-9a-f]{64}$/.test(emailKey), emailKey);

const missingIdentifierKey = accountThrottleKey({ body: {} });
const blankIdentifierKey = accountThrottleKey(reqWith('   '));
const noBodyKey = accountThrottleKey({});
check('a missing identifier gets a fixed sentinel key rather than throwing',
    missingIdentifierKey === 'malformed', missingIdentifierKey);
check('a blank identifier gets the same sentinel', blankIdentifierKey === 'malformed', blankIdentifierKey);
check('a request with no body at all does not throw', noBodyKey === 'malformed', noBodyKey);
check('the sentinel never collides with a real account key', missingIdentifierKey !== emailKey, emailKey);

console.log('\n' + '='.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
