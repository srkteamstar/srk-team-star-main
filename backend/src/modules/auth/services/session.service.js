/*
 * modules/auth/services/session.service.js - resolving, and opening
 * ============================================================================
 *
 * THESE TWO ARE DELIBERATELY SEPARATE FUNCTIONS.
 *
 * resolveIdentifier() answers "whose account is this?". startSession() answers
 * "let them in". The password verifier sits between them in the login route;
 * keeping the grant separate makes it reviewable that no failed credential can
 * fall through into a session.
 *
 * startSession() regenerates the session first, so a session id issued before
 * anyone signed in can never be reused to piggyback onto the one that follows.
 */
const { supabase } = require('../../../core/database/supabase');
const { trimmed } = require('../../../shared/validation');
const { normalizePhone, normalizeEmail, looksLikeEmail } = require('../domain/identifier');

async function resolveIdentifier(identifier) {
    const value = trimmed(identifier);
    if (!value) return null;

    const query = supabase.from('user_profiles').select('*');

    const { data, error } = looksLikeEmail(value)
        ? await query.eq('email', normalizeEmail(value)).maybeSingle()
        : await query.eq('phone_normalized', normalizePhone(value)).maybeSingle();

    if (error) throw error;
    return data || null;
}

// Regenerated on every sign-in so a session id issued beforehand can never be
// reused to piggyback onto this one — standard fixation defence.
//
// THE SCOPE IS WRITTEN, NOT ASKED FOR. This function used to take it as an
// argument, because two sign-in routes shared one cookie. There is one route
// now and one value it can carry, so a caller able to name a different scope
// would be a second way to grant access sitting unread in a signature.
// core/security/guards.js still CHECKS the field rather than assuming it,
// because a session reaching this process from any other source must not be
// trusted on the strength of this file happening to be the only writer.
function startSession(req, customerId) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.customerId = customerId;
            req.session.scope = 'customer';
            req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
    });
}

module.exports = { resolveIdentifier, startSession };
