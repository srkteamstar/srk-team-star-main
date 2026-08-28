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

module.exports = { createOrderAccessToken, hashOrderAccessToken };
