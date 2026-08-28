const { supabase } = require('../../../core/database/supabase');
const {
    sessionScope,
    sessionProfile,
    isBlocked,
    BLOCKED_MESSAGE,
    roleNameById
} = require('../../../core/security/guards');
const { hashOrderAccessToken } = require('../../../shared/order-access-token');

// Resolve access without revealing whether an order belongs to somebody else.
// Account orders are matched to the customer session. Guest orders are matched
// to the SHA-256 hash of the random token returned only at checkout.
async function accessibleOrder(req, orderId) {
    let profile = null;

    if (sessionScope(req) === 'customer') {
        profile = await sessionProfile(req);
        if (profile && isBlocked(profile)) {
            return { status: 403, error: BLOCKED_MESSAGE };
        }
        if (profile) {
            const role = await roleNameById(profile.role_id);
            if (role && role !== 'customer') {
                return { status: 403, error: 'This is not a storefront account.' };
            }

            const owned = await supabase
                .from('orders')
                .select('*')
                .eq('id', orderId)
                .eq('user_id', profile.id)
                .maybeSingle();
            if (owned.error) throw owned.error;
            if (owned.data) return { order: owned.data, profile };
        }
    }

    const suppliedToken = req.get('x-order-access-token');
    if (!suppliedToken) {
        return profile
            ? { status: 404, error: 'No such order.' }
            : { status: 401, error: 'Order access is required.' };
    }

    const tokenHash = hashOrderAccessToken(suppliedToken);
    if (!tokenHash) return { status: 404, error: 'No such order.' };

    const guest = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .eq('guest_access_token_hash', tokenHash)
        .maybeSingle();
    if (guest.error) throw guest.error;
    if (!guest.data) return { status: 404, error: 'No such order.' };

    return { order: guest.data, guest: true };
}

module.exports = { accessibleOrder };
