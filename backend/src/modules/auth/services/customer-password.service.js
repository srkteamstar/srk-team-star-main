/*
 * modules/auth/services/customer-password.service.js
 * ============================================================================
 *
 * Customer passwords never leave this module except as one-way scrypt hashes.
 *
 * TWO FORMATS, ON PURPOSE.
 *
 *   scrypt$<salt>$<hash>              legacy — migration 022's original
 *                                      contract, Node's IMPLICIT defaults
 *                                      (N=16384, r=8, p=1). No cost parameter
 *                                      was ever recorded, so this is the only
 *                                      configuration a bare three-part value
 *                                      can mean.
 *
 *   scrypt$v2$<N>$<r>$<p>$<salt>$<hash>   S06 — an explicit, OWASP-sized cost
 *                                      (N=131072) with its parameters written
 *                                      into the value itself, so a future
 *                                      change of mind about the cost is a new
 *                                      version rather than a silent one.
 *
 * hashCustomerPassword() only ever writes v2. verifyCustomerPassword() reads
 * both, at the parameters each format actually used — a hash minted under the
 * old defaults must be CHECKED under the old defaults; scrypt is not a
 * function you can retroactively ask to have used a bigger N. needsUpgrade()
 * is how a caller learns a just-verified legacy hash should be replaced with a
 * v2 one now that the plaintext password is briefly in hand to do it with.
 *
 * v2's parameters are read back off the STORED VALUE and checked against a
 * one-entry allowlist before they are used for anything, rather than trusted
 * outright — a hash column is written by this module and read by this
 * module, but a corrupted or tampered row must fail closed rather than hand
 * scrypt an attacker-sized N.
 *
 * Node's built-in scrypt implementation keeps this dependency-free. A random
 * salt makes equal passwords produce different rows, and timingSafeEqual keeps
 * verification time independent of the first differing byte. PASSWORD_HASH_-
 * CONCURRENCY bounds how many scrypt calls run at once — v2's cost is
 * deliberately large (128 * N * r bytes, ~128MB per call at these
 * parameters), and every login attempt now runs one (S05's dummy-hash
 * comparison keeps failed attempts on unknown accounts the same shape as real
 * ones), so an unbounded pile of concurrent attempts is a memory-exhaustion
 * path of its own if nothing here queues them.
 *
 * THE QUEUE ITSELF IS ALSO BOUNDED. A concurrency cap alone still lets a
 * distributed flood (many IPs, so per-route rate limiting does not help)
 * queue an unlimited number of waiting requests behind it — the process
 * degrades on queue memory and latency instead of on scrypt's own memory.
 * PASSWORD_HASH_QUEUE_MAX caps how many callers may wait for a slot; once
 * both the active count and the queue are full, gatedScrypt() refuses
 * outright with `error.code = 'AUTH_CAPACITY'` rather than queuing further,
 * and the controller maps that to a 503 with Retry-After.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const rawScrypt = promisify(crypto.scrypt);

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// The only cost parameters this module will ever write, or accept back off a
// v2 value. OWASP's password-storage guidance lists N=2^17 (131072), r=8, p=1
// as an accepted scrypt configuration; maxmem is set above the ~128MB this
// needs (128 * N * r) because Node's own default ceiling (32MB) is sized for
// its OLD implicit N, not this one.
const SCRYPT_V2 = { version: 2, N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

// Node's historical implicit defaults — never written again, kept only so a
// legacy value can still be verified at the cost it was actually hashed with.
const SCRYPT_LEGACY = { N: 16384, r: 8, p: 1 };

function positiveIntEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// CONCURRENCY CAP, WITH A BOUNDED QUEUE BEHIND IT
// ---------------------------------------------------------------------------
// A small FIFO queue in front of every scrypt call in this module, legacy and
// v2 alike. Node's thread pool would otherwise happily start every concurrent
// request's hash at once; at v2's cost that is a server asking its own
// memory for N * concurrent-requests worth of scrypt buffers on demand.
//
// Both numbers are configurable because the right value depends on the
// container this actually runs in — a safe starting point for a 512-1024MiB
// Node process is roughly two active hashes, but that should be benchmarked
// against the real deployment rather than hard-coded here.
const PASSWORD_HASH_CONCURRENCY = positiveIntEnv('PASSWORD_HASH_CONCURRENCY', 2);
const PASSWORD_HASH_QUEUE_MAX = positiveIntEnv('PASSWORD_HASH_QUEUE_MAX', 32);

let active = 0;
const queue = [];

function runScrypt(password, salt, keylen, options) {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            active++;
            rawScrypt(password, salt, keylen, options)
                .then(resolve, reject)
                .finally(() => {
                    active--;
                    const next = queue.shift();
                    if (next) next();
                });
        };

        if (active < PASSWORD_HASH_CONCURRENCY) {
            attempt();
            return;
        }

        // Every slot is busy and the queue is already at its cap — refuse
        // outright rather than growing the queue without limit. The caller
        // (hashCustomerPassword / verifyCustomerPassword) rejects with this
        // same error; auth controllers map AUTH_CAPACITY to 503.
        if (queue.length >= PASSWORD_HASH_QUEUE_MAX) {
            const error = new Error('Too many password operations are already in progress.');
            error.code = 'AUTH_CAPACITY';
            reject(error);
            return;
        }

        queue.push(attempt);
    });
}

function passwordProblem(password) {
    if (typeof password !== 'string' || !password) return 'Enter a password.';
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use no more than ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
}

function encodeV2(salt, key) {
    return ['scrypt', 'v2', SCRYPT_V2.N, SCRYPT_V2.r, SCRYPT_V2.p, salt.toString('hex'), Buffer.from(key).toString('hex')].join('$');
}

async function hashCustomerPassword(password) {
    const problem = passwordProblem(password);
    if (problem) throw new TypeError(problem);

    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await runScrypt(password, salt, KEY_BYTES, SCRYPT_V2);
    return encodeV2(salt, key);
}

function decodePart(value, expectedBytes) {
    if (new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) {
        return Buffer.from(value, 'hex');
    }
    return Buffer.from(value, 'base64url');
}

// A stored value is either the bare three-part legacy format or the
// seven-part v2 one; anything else is not a hash this module ever wrote.
function parseStoredHash(storedHash) {
    if (typeof storedHash !== 'string') return null;
    const parts = storedHash.split('$');

    if (parts.length === 3 && parts[0] === 'scrypt') {
        return { version: 1, saltPart: parts[1], keyPart: parts[2], options: SCRYPT_LEGACY };
    }

    if (parts.length === 7 && parts[0] === 'scrypt' && parts[1] === 'v2') {
        const N = Number(parts[2]);
        const r = Number(parts[3]);
        const p = Number(parts[4]);

        // Read off the stored value, then checked against the one
        // configuration this module will actually run — never handed to
        // scrypt() on the strength of appearing in the column.
        if (N !== SCRYPT_V2.N || r !== SCRYPT_V2.r || p !== SCRYPT_V2.p) return null;

        return { version: 2, saltPart: parts[5], keyPart: parts[6], options: SCRYPT_V2 };
    }

    return null;
}

async function verifyCustomerPassword(password, storedHash) {
    if (typeof password !== 'string') return false;

    const parsed = parseStoredHash(storedHash);
    if (!parsed) return false;

    let salt;
    let expected;
    try {
        salt = decodePart(parsed.saltPart, SALT_BYTES);
        expected = decodePart(parsed.keyPart, KEY_BYTES);
    } catch (error) {
        return false;
    }

    // A malformed database value must be a refusal, not an attacker-controlled
    // request for an arbitrarily large scrypt allocation.
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

    const actual = Buffer.from(await runScrypt(password, salt, KEY_BYTES, parsed.options));
    return crypto.timingSafeEqual(actual, expected);
}

// True for a hash this module can still verify but would no longer write —
// the caller's cue to mint a fresh v2 hash from the password it just checked
// and save it, now that the plaintext is briefly in hand. A hash that fails
// to parse at all is not "legacy that needs upgrading"; it is not a hash this
// module recognises, and verifyCustomerPassword() already refused it.
function needsUpgrade(storedHash) {
    const parsed = parseStoredHash(storedHash);
    return !!parsed && parsed.version < SCRYPT_V2.version;
}

// S05: the constant-time comparison every login now runs against, whether or
// not the identifier resolved to an account, so that "no such account" and
// "wrong password" cost the same scrypt call and cannot be told apart by
// timing. Computed once per process (not per request) and cached — an actual
// v2 hash, from a fixed placeholder that has never been anyone's password,
// so its cost is identical to a real row's.
const DUMMY_PASSWORD = 'srk-dummy-password-never-assigned-to-any-account';
let dummyHashPromise = null;

function dummyHash() {
    if (!dummyHashPromise) dummyHashPromise = hashCustomerPassword(DUMMY_PASSWORD);
    return dummyHashPromise;
}

module.exports = {
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
    passwordProblem,
    hashCustomerPassword,
    verifyCustomerPassword,
    needsUpgrade,
    dummyHash
};
