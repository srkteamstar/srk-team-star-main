const crypto = require('crypto');

function hashOrderAccessToken(token) {
    const value = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(value)) return null;
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createOrderAccessToken() {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, hash: hashOrderAccessToken(token) };
}

// A RANDOMLY-GENERATED RETRY IDENTIFIER, NOT A FREE-FORM STRING.
//
// checkout.controller.js's idempotency lookup used to accept any non-empty
// string up to 100 characters as a retry key — which is also, in effect, a
// bearer credential for reading an order back and (for a guest) rotating its
// access token. A short or hand-picked value is not a secret, so anybody
// could try one. crypto.randomUUID() output (and nothing else) is what both
// the idempotency key and the separate checkout-proof value below are
// required to look like: 122 bits of randomness, not guessable, and not
// something a client could produce with Math.random().
const RETRY_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStrongRetryToken(value) {
    return typeof value === 'string' && RETRY_TOKEN_PATTERN.test(value.trim());
}

// The guest "checkout proof" (S04): a second random value, independent of
// the idempotency key, that the browser generates and holds locally
// alongside it — see checkout-module.js's randomIdempotencyKey() neighbour.
// Only its hash is ever stored, the same discipline hashOrderAccessToken()
// already follows, so leaking the idempotency key alone (logs, a shared
// screen, a guessed value) is not enough on its own to read a guest order
// back or rotate its real access token.
function hashCheckoutProof(value) {
    if (!isStrongRetryToken(value)) return null;
    return crypto.createHash('sha256').update(value.trim(), 'utf8').digest('hex');
}

module.exports = {
    createOrderAccessToken,
    hashOrderAccessToken,
    isStrongRetryToken,
    hashCheckoutProof
};
