/*
 * modules/auth/auth.public.js - what siblings may hold
 * ============================================================================
 *
 * THE ONLY FILE IN THIS MODULE ANOTHER MODULE MAY REQUIRE.
 *
 * modules/checkout uses these narrow reads and normalizers for two distinct
 * paths: signed-in customers get authoritative account contact data and a
 * saved-address update; guests get normalized contact values frozen directly
 * on their order. Checkout does not create accounts or open sessions.
 */
const { normalizePhone, normalizeEmail } = require('./domain/identifier');
const { addressForUser } = require('./infrastructure/profile.repository');
const { publicProfile } = require('./services/profile-view.service');

module.exports = {
    normalizePhone,
    normalizeEmail,
    addressForUser,
    publicProfile
};

// roleIdByName is deliberately NOT re-exported here. It is a core RBAC
// resolver (core/security/guards.js) rather than something this module owns,
// and re-exporting it would make auth look like its source - which is how a
// sibling ends up importing a constant through three files.
