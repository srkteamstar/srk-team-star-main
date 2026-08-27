/*
 * modules/auth/services/profile-view.service.js - entity to response DTO
 * ============================================================================
 *
 * THE DTO BOUNDARY, and the one place in this application where the doctrine's
 * "never return an entity from a controller" rule is doing visible work.
 *
 * A user_profiles row carries role_id, is_blocked, blocked_at,
 * a second-factor secret. publicProfile() is what stops
 * any of that reaching a browser: every storefront route that answers with an
 * account answers with THIS shape, so there is one place to check rather than
 * five.
 */
const { roleNameById } = require('../../../core/security/guards');
const { addressForUser } = require('../infrastructure/profile.repository');

async function publicProfile(profile) {
    if (!profile) return null;

    const [address, role] = await Promise.all([
        addressForUser(profile.id),
        roleNameById(profile.role_id)
    ]);

    return {
        id: profile.id,
        email: profile.email || '',
        name: profile.full_name || '',
        phone: profile.phone_number || '',
        company: profile.company || '',
        created_at: profile.created_at,
        role: role,
        address_line: address ? address.full_address || '' : '',
        city: address ? address.city || '' : '',
        state: address ? address.state || '' : '',
        postal_code: address ? address.zip_code || '' : '',
        country: address ? address.country || '' : ''
    };
}

// Both identifiers reach the same account, so sign-in accepts either without

module.exports = { publicProfile };
