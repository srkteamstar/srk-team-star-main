/*
 * modules/auth/infrastructure/profile.repository.js
 * ============================================================================
 *
 * The one read here that is not a route's own query: the single saved address
 * a profile may carry.
 *
 * roleIdByName USED TO LIVE HERE AND NOW DOES NOT. It reads the roles cache
 * that core/security/guards.js owns, so it sits next to that cache instead of
 * reaching for it across a boundary - and it is a generic RBAC resolver, which
 * is what core/security is for. Both this module and modules/checkout import
 * it from there.
 */
const { supabase } = require('../../../core/database/supabase');

async function addressForUser(userId) {
    const { data, error } = await supabase
        .from('shipping_addresses')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

// One shape for every route that hands a customer back, and deliberately the
// shape profile-icon-loader.js already reads — the overlay was written
// against these names when they came out of localStorage, so pointing it at
// the database is a change of source, not of contract.
//
// The address is flattened into the profile rather than nested, for the same
// reason: one saved address is a property of the customer, and nesting it

module.exports = { addressForUser };
