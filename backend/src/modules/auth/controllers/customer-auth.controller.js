/*
 * modules/auth/controllers/customer-auth.controller.js - the storefront door
 * ============================================================================
 *
 *   POST   /api/auth/register   step 01 of signup, commits on its own
 *   POST   /api/auth/login      identifier + password
 *   POST   /api/auth/logout
 *   GET    /api/auth/me         answers { customer: null } for a non-customer session
 *   PATCH  /api/auth/me         edit my own details, role_id refused
 *
 * GET /api/auth/me IS THE ONLY THING THE STOREFRONT LEARNS WHO YOU ARE FROM,
 * which is why the non-customer answer is decided there and nowhere else: a
 * null customer means there is no greeting to suppress, no order history to
 * hide and no onboarding step to skip - a class of special case deleted rather
 * than added to.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireCustomer, sessionScope, sessionProfile, isBlocked, BLOCKED_MESSAGE, roleNameById, roleIdByName } = require('../../../core/security/guards');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong, trimmed } = require('../../../shared/validation');
const { normalizePhone, normalizeEmail, looksLikeEmail } = require('../domain/identifier');
const { addressForUser } = require('../infrastructure/profile.repository');
const { publicProfile } = require('../services/profile-view.service');
const { resolveIdentifier, startSession } = require('../services/session.service');
const { passwordProblem, hashCustomerPassword, verifyCustomerPassword } = require('../services/customer-password.service');
const { authLimiter } = require('../infrastructure/auth-rate-limit');

/** @returns {import('express').Router} */
function customerAuthController() {
    const router = express.Router();

    // ---- Register — step 01, contact details -----------------------------------
    // The overlay collects the shipping address as step 02 and sends it to
    // PATCH /api/auth/me. Splitting it this way is not just presentation:
    // user_profiles requires full_name, email and phone_number and knows nothing
    // about an address, so step 01 is exactly the row this table needs and step
    // 02 is exactly the row the other one does. Abandoning between the two
    // leaves a real account with no address, which is a state the account view
    // already handles — it is what needsOnboarding() has always meant.
    router.post('/api/auth/register', authLimiter, async (req, res) => {
        const name = trimmed(req.body.name);
        const email = normalizeEmail(req.body.email);
        const phone = trimmed(req.body.phone);
        const company = trimmed(req.body.company);
        const phoneDigits = normalizePhone(phone);
        const password = req.body && req.body.password;

        if (!name) return res.status(400).json({ field: 'name', error: "Enter your name." });
        if (!email) return res.status(400).json({ field: 'email', error: "Enter an email address." });
        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ field: 'email', error: "Enter a valid email address." });
        }
        if (!phone) return res.status(400).json({ field: 'phone', error: "Enter a phone number." });
        if (phoneDigits.length < 7) {
            return res.status(400).json({ field: 'phone', error: "Enter a phone number we can reach you on." });
        }
        const passwordError = passwordProblem(password);
        if (passwordError) return res.status(400).json({ field: 'password', error: passwordError });
        try {
            // Checked before inserting so the customer gets the message against
            // the field that caused it. The unique indexes are still what makes
            // it true — this is the friendly path, not the guarantee.
            const [byEmail, byPhone] = await Promise.all([
                supabase.from('user_profiles').select('id').eq('email', email).maybeSingle(),
                supabase.from('user_profiles').select('id').eq('phone_normalized', phoneDigits).maybeSingle()
            ]);

            if (byEmail.error) throw byEmail.error;
            if (byPhone.error) throw byPhone.error;

            if (byEmail.data) {
                return res.status(409).json({ field: 'email', error: "That email already has an account. Sign in instead." });
            }
            if (byPhone.data) {
                return res.status(409).json({ field: 'phone', error: "That phone number already has an account. Sign in instead." });
            }

            const row = {
                full_name: name,
                email: email,
                phone_number: phone,
                phone_normalized: phoneDigits,
                company: company || null,
                password_hash: await hashCustomerPassword(password)
            };

            // Never from the request. A role_id in the body is the one field that
            // would turn signup into privilege escalation.
            const customerRole = await roleIdByName('customer');
            if (customerRole !== null) row.role_id = customerRole;

            const { data, error } = await supabase
                .from('user_profiles')
                .insert([row])
                .select()
                .single();

            if (error) throw error;

            await startSession(req, data.id);
            res.status(201).json({ customer: await publicProfile(data) });
        } catch (error) {
            console.error("Register Error:", error);
            // 23505 is a unique violation — the two checks above raced, or an
            // index this route does not know about fired.
            if (error && error.code === '23505') {
                return res.status(409).json({ field: 'email', error: "That account already exists. Sign in instead." });
            }
            res.status(500).json({ error: "Could not create your account." });
        }
    });

    // ---- Sign in ---------------------------------------------------------------
    router.post('/api/auth/login', authLimiter, async (req, res) => {
        const identifier = trimmed(req.body.identifier);
        const password = req.body && req.body.password;

        if (!identifier) {
            return res.status(400).json({ field: 'identifier', error: "Enter your email or phone number." });
        }
        if (looksLikeEmail(identifier) && !EMAIL_PATTERN.test(normalizeEmail(identifier))) {
            return res.status(400).json({ field: 'identifier', error: "Enter a valid email address." });
        }
        if (!looksLikeEmail(identifier) && normalizePhone(identifier).length < 7) {
            return res.status(400).json({ field: 'identifier', error: "Enter a valid phone number, or use your email." });
        }
        const passwordError = passwordProblem(password);
        if (passwordError) return res.status(400).json({ field: 'password', error: passwordError });
        try {
            const profile = await resolveIdentifier(identifier);

            if (!profile) {
                // `account_not_found` is a machine-readable copy of what the
                // status code and the sentence already say, added so the account
                // overlay can offer the two ways forward (try another
                // identifier, or create the account) instead of leaving a red
                // line under the field and nothing to press. It discloses
                // nothing the 404 did not — authLimiter is what keeps this from
                // being an enumeration oracle, and it is unchanged.
                return res.status(404).json({
                    account_not_found: true,
                    field: 'identifier',
                    error: "We could not find an account with that email or phone."
                });
            }

            // Before the session: a suspended account is refused whoever it
            // belongs to.
            if (isBlocked(profile)) {
                return res.status(403).json({ error: BLOCKED_MESSAGE });
            }

            // ONLY A CUSTOMER COMES THROUGH THIS DOOR.
            //
            // A row that is not a customer is refused here rather than being
            // handed a session that later checks would have to catch — and it
            // is refused for the account, not for the role.
            //
            // THE ANSWER SAYS NOTHING ABOUT WHY. An earlier version replied
            // "that is an administrator account", with a flag the account
            // overlay branched on. It was true and it was helpful to exactly
            // one person, and it turned a route anybody may call into a way to
            // ask "is this address privileged?" of any address somebody had
            // already guessed. Nothing on this site needs that question
            // answered, so it is not. authLimiter remains the thing that keeps
            // the identifier check itself from being an enumeration oracle.
            const role = await roleNameById(profile.role_id);

            if (role && role !== 'customer') {
                return res.status(403).json({
                    field: 'identifier',
                    error: "That account cannot be used to sign in here."
                });
            }

            // A profile created while identifier-only access was enabled may
            // have no hash. Never turn that legacy state into a password bypass:
            // it stays locked until its credential is reset out of band.
            if (!profile.password_hash) {
                return res.status(403).json({
                    field: 'password',
                    error: "This account needs a password reset before it can sign in. Contact us for help."
                });
            }

            if (!await verifyCustomerPassword(password, profile.password_hash)) {
                return res.status(401).json({
                    field: 'password',
                    error: "That password is not correct."
                });
            }

            await startSession(req, profile.id);

            res.status(200).json({ customer: await publicProfile(profile) });
        } catch (error) {
            console.error("Login Error:", error);
            res.status(500).json({ error: "Could not sign you in." });
        }
    });

    // ---- Sign out --------------------------------------------------------------
    router.post('/api/auth/logout', (req, res) => {
        if (!req.session) return res.status(200).json({ success: true });

        req.session.destroy((err) => {
            if (err) {
                console.error("Session Destroy Error:", err);
                return res.status(500).json({ error: "Failed to sign out." });
            }
            res.clearCookie('srk_sid');
            res.status(200).json({ success: true });
        });
    });

    // ---- Who am I — STOREFRONT --------------------------------------------------
    // 200 with a null customer when signed out, never 401: "is anyone signed in?"
    // is a question every page load asks, and an error answer would have the
    // overlay reporting a failure for the ordinary case of a first visit.
    //
    // A SESSION THIS APPLICATION DID NOT OPEN READS AS SIGNED OUT HERE, and
    // that single line is what keeps a non-customer off the storefront rather
    // than a collection of special cases spread across the account overlay,
    // the order history and the cart. Everything the store knows about who you
    // are, it learns from this route; answer null and there is no greeting to
    // suppress, no order history to hide and no onboarding step to skip.
    //
    // It is the same treatment a blocked account already gets two lines down, for
    // a related reason: this route answers "is a customer signed in?", and for
    // both of them the honest storefront rendering is the signed-out one.
    router.get('/api/auth/me', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        if (sessionScope(req) !== 'customer') {
            return res.status(200).json({ customer: null });
        }

        try {
            const profile = await sessionProfile(req);

            // A blocked account reads as signed out here, deliberately, rather
            // than as an error: this route answers "is anyone signed in?" on
            // every page load, and the storefront's only sensible rendering of a
            // suspended session is the signed-out one. The refusal with a reason
            // belongs on the sign-in attempt, where somebody is actually asking.
            if (isBlocked(profile)) {
                return res.status(200).json({ customer: null });
            }

            res.status(200).json({ customer: await publicProfile(profile) });
        } catch (error) {
            console.error("Session Read Error:", error);
            res.status(500).json({ error: "Could not read your session." });
        }
    });

    // ---- Edit my details -------------------------------------------------------
    // Writes the profile and the one shipping address together. Both halves are
    // optional: step 02 of signup sends only the address, and Edit Details sends
    // both.
    //
    // email is not editable here and neither is role_id. The address is upserted
    // against the unique index from migration 011, so a customer can never end up
    // with two.
    router.patch('/api/auth/me', requireCustomer, async (req, res) => {
        const body = req.body || {};
        const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

        const profileUpdate = {};
        if (has('name')) {
            const name = trimmed(body.name);
            if (!name) return res.status(400).json({ field: 'name', error: "Enter your name." });
            profileUpdate.full_name = name;
        }
        if (has('phone')) {
            const phone = trimmed(body.phone);
            const digits = normalizePhone(phone);
            if (digits.length < 7) {
                return res.status(400).json({ field: 'phone', error: "Enter a phone number we can reach you on." });
            }
            profileUpdate.phone_number = phone;
            profileUpdate.phone_normalized = digits;
        }
        if (has('company')) profileUpdate.company = trimmed(body.company) || null;

        const addressKeys = ['address_line', 'city', 'state', 'postal_code', 'country'];
        const touchesAddress = addressKeys.some(has);

        try {
            if (Object.keys(profileUpdate).length) {
                profileUpdate.updated_at = new Date().toISOString();

                const { error } = await supabase
                    .from('user_profiles')
                    .update(profileUpdate)
                    .eq('id', req.profile.id);

                if (error) throw error;
            }

            if (touchesAddress) {
                const existing = await addressForUser(req.profile.id);

                // Merged over what is already saved, so sending only a city does
                // not blank the street. The columns are NOT NULL, so an absent
                // field with nothing behind it becomes '' rather than null.
                const merged = {
                    user_id: req.profile.id,
                    full_address: has('address_line') ? trimmed(body.address_line) : (existing ? existing.full_address : ''),
                    city: has('city') ? trimmed(body.city) : (existing ? existing.city : ''),
                    state: has('state') ? trimmed(body.state) : (existing ? existing.state : ''),
                    country: has('country') ? trimmed(body.country) : (existing ? existing.country : ''),
                    zip_code: has('postal_code') ? trimmed(body.postal_code) : (existing ? existing.zip_code : '')
                };

                if (!merged.full_address) {
                    return res.status(400).json({ field: 'address_line', error: "Enter a street address." });
                }
                if (!merged.city) {
                    return res.status(400).json({ field: 'city', error: "Enter a city." });
                }

                if (existing) {
                    merged.updated_at = new Date().toISOString();
                    const { error } = await supabase
                        .from('shipping_addresses')
                        .update(merged)
                        .eq('id', existing.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase.from('shipping_addresses').insert([merged]);
                    if (error) throw error;
                }
            }

            const fresh = await sessionProfile(req);
            res.status(200).json({ customer: await publicProfile(fresh) });
        } catch (error) {
            console.error("Profile Update Error:", error);
            if (error && error.code === '23505') {
                return res.status(409).json({ field: 'phone', error: "That phone number is already on another account." });
            }
            res.status(500).json({ error: "Could not save your details." });
        }
    });

    return router;
}

module.exports = { customerAuthController };
