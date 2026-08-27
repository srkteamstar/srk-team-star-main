/*
 * modules/auth/services/customer-password.service.js
 * ============================================================================
 *
 * Customer passwords never leave this module except as one-way scrypt hashes.
 * The database format intentionally matches migration 022's historical
 * contract: scrypt$salt$hash. New values use hex, and verification also
 * accepts base64url so either historical representation remains readable.
 *
 * Node's built-in scrypt implementation keeps this dependency-free. A random
 * salt makes equal passwords produce different rows, and timingSafeEqual keeps
 * verification time independent of the first differing byte.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function passwordProblem(password) {
    if (typeof password !== 'string' || !password) return 'Enter a password.';
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use no more than ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
}

async function hashCustomerPassword(password) {
    const problem = passwordProblem(password);
    if (problem) throw new TypeError(problem);

    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await scrypt(password, salt, KEY_BYTES);
    return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}

function decodePart(value, expectedBytes) {
    if (new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) {
        return Buffer.from(value, 'hex');
    }
    return Buffer.from(value, 'base64url');
}

async function verifyCustomerPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;

    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    let salt;
    let expected;
    try {
        salt = decodePart(parts[1], SALT_BYTES);
        expected = decodePart(parts[2], KEY_BYTES);
    } catch (error) {
        return false;
    }

    // A malformed database value must be a refusal, not an attacker-controlled
    // request for an arbitrarily large scrypt allocation.
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;

    const actual = Buffer.from(await scrypt(password, salt, KEY_BYTES));
    return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
    passwordProblem,
    hashCustomerPassword,
    verifyCustomerPassword
};
