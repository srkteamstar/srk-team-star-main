/*
 * core/security/guards.js — who is asking, and are they allowed
 * ============================================================================
 *
 * The doctrine puts "core authentication guards and generic role-based access
 * control resolvers" in core/, and that is exactly what these are: they answer
 * "is there a session, whose is it, and what may it do" without knowing a
 * single thing about enquiries, carts or orders. Every module imports them;
 * they import no module.
 *
 * modules/auth OPENS a session (it owns the two doors and what they demand).
 * This file READS one. The split matters: a route that can create a session is
 * a route that can grant access, and there are exactly two of those, both in
 * one module, both rate limited. Everything else in the application only ever
 * arrives here.
 *
 * modules/auth OPENS the session; this file READS one. The split matters: a
 * route that can create a session is a route that can grant access, and there
 * is exactly one of those, in one module, rate limited. Everything else in the
 * application only ever arrives here.
 */
const { supabase } = require('../database/supabase');
const { errorTag } = require('../../shared/error-tag');

// AUTHORIZATION
//
// ONE DOOR, ONE KIND OF SESSION, AND TWO CHECKS ON IT.
//
//   POST /api/auth/login    the storefront. A customer identifier and password.
//
// A session records which door it came through, in `req.session.scope`.
// With one door that field looks redundant, and it is not: the role in the
// database says what someone MAY be, the scope says what they signed in AS,
// and requireCustomer below demands both. Either alone is a hole. Without the
// role check, a scope could be forged by a future route that forgets to set
// it. Without the scope check, any session pointing at a non-customer row
// would satisfy requireCustomer and be handed a cart, a delivery address and
// an order history that such a row has no business holding.
//
// The role is read from the database on every request rather than stamped
// into the session at sign-in, so a role changed or an account suspended
// under a live cookie takes effect on the next click instead of whenever the
// 30-day cookie happens to expire.
//
// NOTHING HERE CAN *RAISE* A ROLE, and that is what keeps the door shut
// rather than any single check above. Signup hard-codes the customer role,
// PATCH /api/auth/me refuses role_id, POST /api/checkout refuses to adopt or
// create a non-customer profile, and changing somebody's role is a hand edit
// in the Supabase table editor. Section 6 of authz.test.js asserts each one.
//
// These are `function` declarations so they hoist above the route table
// below, which evaluates its middleware arguments at load time.

// roles has two rows and gains more roughly never, so one query per process
// beats one per request. A restart is the cache invalidation.
let rolesCache = null;
async function roleNameById(id) {
    if (id === null || id === undefined) return null;

    if (!rolesCache) {
        const { data, error } = await supabase.from('roles').select('id, role_name');
        if (error) throw error;
        rolesCache = new Map((data || []).map(r => [String(r.id), String(r.role_name || '').toLowerCase()]));
    }

    return rolesCache.get(String(id)) || null;
}


// The inverse of roleNameById, and it lives here for one concrete reason:
// it reads `rolesCache`, which is private to this file. Signup needs it to
// stamp the customer role on a new profile and checkout needs it for the same
// reason on a guest account - so exporting the cache for a module to walk
// would be publishing an implementation detail, where publishing the question
// ("which id is the customer role?") is publishing an answer.
async function roleIdByName(name) {
    await roleNameById(1);            // populates rolesCache
    if (!rolesCache) return null;

    for (const [id, roleName] of rolesCache.entries()) {
        if (roleName === name) return Number(id);
    }
    return null;
}

// The signed-in profile, or null. Read fresh every time: a profile deleted
// from under a live cookie has to read as signed out, not as a ghost.
async function sessionProfile(req) {
    const id = req.session && req.session.customerId;
    if (!id) return null;

    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

// Suspension is set outside this process, on the row itself. It is checked on
// every request that reads a session rather than only at sign-in, so blocking
// somebody who is already signed in takes effect on their next click instead
// of whenever their 30-day cookie happens to expire — the same reasoning the
// role check above gives for reading the role fresh every time.
const isBlocked = (profile) => !!profile && profile.is_blocked === true;

const BLOCKED_MESSAGE = "This account has been suspended. Contact us if you think that is a mistake.";

// A scope is an authorization claim, so absence is absence — never the most
// privileged value this process understands. Existing sessions are deliberately
// invalidated once by this change; accepting an unscoped cookie would preserve
// the authorization hole indefinitely.
const sessionScope = (req) => req.session && req.session.scope
    ? String(req.session.scope)
    : null;

// A storefront session, and nothing else reaches past it. Both halves are
// required: a session whose scope is not 'customer' did not come through this
// application's door, and a session pointing at a row that is not a customer
// is a state no route here can produce — this is what keeps it that way if
// one ever tries.
async function requireCustomer(req, res, next) {
    try {
        if (sessionScope(req) !== 'customer') {
            return res.status(401).json({ error: "Not signed in." });
        }

        const profile = await sessionProfile(req);
        if (!profile) return res.status(401).json({ error: "Not signed in." });
        if (isBlocked(profile)) return res.status(403).json({ error: BLOCKED_MESSAGE });

        const role = await roleNameById(profile.role_id);
        if (role !== 'customer') {
            return res.status(403).json({ error: "This is not a storefront account." });
        }

        req.profile = profile;
        next();
    } catch (error) {
        console.error("Session lookup failed:", errorTag(error));
        res.status(500).json({ error: "Could not verify your session." });
    }
}

module.exports = {
    roleNameById,
    roleIdByName,
    sessionProfile,
    isBlocked,
    BLOCKED_MESSAGE,
    sessionScope,
    requireCustomer
};

// THERE IS EXACTLY ONE GUARD HERE, AND THAT IS NOT AN OVERSIGHT.
//
// This process serves the storefront. Every role it can meet is a customer or
// is refused, so a second guard would be one with no route to stand in front
// of — and an exported guard with no caller is an unguarded door waiting for
// somebody to decide it implies a route.
//
// The scope and role checks inside requireCustomer are not leftovers of that.
// They are the storefront's own rule: an account that is not a customer must
// never hold a cart, a delivery address or an order history HERE, whatever it
// may be entitled to anywhere else, and this is the one place that is decided.
