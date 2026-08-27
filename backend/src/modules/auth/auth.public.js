/*
 * modules/auth/auth.public.js - what siblings may hold
 * ============================================================================
 *
 * THE ONLY FILE IN THIS MODULE ANOTHER MODULE MAY REQUIRE.
 *
 * ONE CALLER, AND ONE REASON. modules/checkout serves guests, and
 * orders.user_id is NOT NULL, so a guest checkout has to find or create the
 * account the order will hang from and then sign them in. That is genuinely
 * an auth operation, and the alternative - checkout writing user_profiles and
 * req.session itself - is how a second, unreviewed way to mint a session gets
 * into the codebase.
 *
 * startSession IS A WRITE CROSSING A MODULE BOUNDARY, which the doctrine says
 * should be an event rather than a call. It stays a call, deliberately: the
 * customer must be signed in by the time the checkout response is written, and
 * an asynchronous event cannot promise that. The exception is recorded in
 * ARCHITECTURE.md rather than left for a reader to find.
 *
 * WHAT PROTECTS IT. POST /api/checkout refuses to adopt or create a profile
 * that is not a customer, so this cannot be used to mint a privileged session
 * from a public form. That guard is asserted in authz.test.js.
 */
const { normalizePhone, normalizeEmail } = require('./domain/identifier');
const { addressForUser } = require('./infrastructure/profile.repository');
const { publicProfile } = require('./services/profile-view.service');
const { startSession } = require('./services/session.service');

module.exports = { normalizePhone, normalizeEmail, addressForUser, publicProfile, startSession };

// roleIdByName is deliberately NOT re-exported here. It is a core RBAC
// resolver (core/security/guards.js) rather than something this module owns,
// and re-exporting it would make auth look like its source - which is how a
// sibling ends up importing a constant through three files.
