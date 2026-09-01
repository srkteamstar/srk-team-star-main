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
const { requireCustomer, sessionScope, sessionProfile, isBlocked, roleNameById, roleIdByName } = require('../../../core/security/guards');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong, trimmed } = require('../../../shared/validation');
const { normalizePhone, normalizeEmail, looksLikeEmail } = require('../domain/identifier');
const { addressForUser } = require('../infrastructure/profile.repository');
const { publicProfile } = require('../services/profile-view.service');
const { resolveIdentifier, startSession } = require('../services/session.service');
const { passwordProblem, hashCustomerPassword, verifyCustomerPassword, needsUpgrade, dummyHash } = require('../services/customer-password.service');
const { authLimiter, accountLoginLimiter } = require('../infrastructure/auth-rate-limit');
// S01/S03: every catch block below used to log the raw error object. A
// Supabase/Postgres error's message can echo the value that caused it back
// (a unique-violation names the duplicate value; a constraint failure can
// name the offending column's content), and every route in this file writes
// or reads account data. A short, stable tag is enough to triage a failure
// from platform logs without a second copy of anyone's submitted details
// sitting in them. Shared now (shared/error-tag.js) so every other
// controller with the same problem uses the same redaction.
const { errorTag } = require('../../../shared/error-tag');

// A scrypt flood that fills the password-hashing gate (see
// customer-password.service.js) is a capacity problem, not a client error —
// the honest answer is "come back shortly," not a 400 or a 500. The value is
// small and fixed on purpose: it is a hint for a browser retry, not a promise
// about queue depth.
const PASSWORD_CAPACITY_RETRY_SECONDS = 2;

function sendCapacityRefusal(res) {
    res.set('Retry-After', String(PASSWORD_CAPACITY_RETRY_SECONDS));
    res.status(503).json({ error: "We're handling a lot of sign-in activity right now. Please try again in a few seconds." });
}

// Registration used to answer a colliding email or phone with a field-specific
// 409 ("that email already has an account"), which is a free existence oracle
// for anyone who can post to this route — repeat with a guessed address and
// read the status code. Both a genuinely new registration and a collision now
// answer with exactly this response: same status, same body, nothing that
// depends on which happened. A real OTP/verification flow is out of scope
// here (none exists in this codebase yet); this only closes the response-shape
// leak, not the timing one — the "already exists" path still returns sooner
// because it never reaches the scrypt hash below, same as it always has.
const REGISTER_ACCEPTED_MESSAGE = 'If this contact can be registered, verification instructions will follow.';
function sendRegisterAccepted(res) {
    return res.status(202).json({ success: true, message: REGISTER_ACCEPTED_MESSAGE });
}

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

        const lengthError = tooLong('Name', name, MAX_LENGTHS.name)
            || tooLong('Email', email, MAX_LENGTHS.email)
            || tooLong('Phone', phone, MAX_LENGTHS.phone)
            || tooLong('Company', company, MAX_LENGTHS.company);
        if (lengthError) return res.status(400).json({ error: lengthError });

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

            if (byEmail.data || byPhone.data) {
                // Deliberately not field-specific and not distinguished from
                // the "created" response below — see sendRegisterAccepted.
                return sendRegisterAccepted(res);
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
            return sendRegisterAccepted(res);
        } catch (error) {
            console.error("Register Error:", errorTag(error));
            if (error && error.code === 'AUTH_CAPACITY') {
                return sendCapacityRefusal(res);
            }
            // 23505 is a unique violation — the two checks above raced, or an
            // index this route does not know about fired. Same response as
            // any other collision: nothing here should differ from the
            // "created" path either.
            if (error && error.code === '23505') {
                return sendRegisterAccepted(res);
            }
            res.status(500).json({ error: "Could not create your account." });
        }
    });

    // ---- Sign in ---------------------------------------------------------------
    //
    // S05: unknown identifier, wrong password, a suspended account, a
    // non-customer role and a legacy no-hash account used to answer with four
    // different status/body pairs (404, 401, and two distinctly-worded 403s).
    // Together they let a caller classify an identifier and its account state
    // without ever needing the password right, and authLimiter only ever
    // bounded that by IP. Every one of those refusals now folds into
    // `eligible`, and whichever way it comes out, verifyCustomerPassword()
    // runs exactly once — against the real hash when eligible, against a
    // precomputed dummy hash of the same cost otherwise — so a timing
    // difference cannot separate them either. THE REFUSAL ITSELF IS
    // UNCHANGED: a suspended, non-customer or hashless account still cannot
    // sign in here; only what an anonymous caller is told about *why* is.
    // accountLoginLimiter adds a second, account-keyed budget alongside
    // authLimiter's per-IP one, so spreading the guessing across addresses no
    // longer sidesteps every limit — see auth-rate-limit.js for why that
    // budget can never become a permanent lock on the account it protects.
    router.post('/api/auth/login', authLimiter, accountLoginLimiter, async (req, res) => {
        const identifier = trimmed(req.body.identifier);
        const password = req.body && req.body.password;

        const identifierLimit = looksLikeEmail(identifier) ? MAX_LENGTHS.email : MAX_LENGTHS.phone;
        const identifierLengthError = tooLong('Email or phone', identifier, identifierLimit);
        if (identifierLengthError) {
            return res.status(400).json({ field: 'identifier', error: identifierLengthError });
        }

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
            const role = profile ? await roleNameById(profile.role_id) : null;

            const eligible = Boolean(profile)
                && Boolean(profile.password_hash)
                && !isBlocked(profile)
                && role === 'customer';

            const matched = await verifyCustomerPassword(
                password,
                eligible ? profile.password_hash : await dummyHash()
            );

            if (!eligible || !matched) {
                return res.status(401).json({
                    field: 'password',
                    error: "The sign-in details could not be verified."
                });
            }

            // S06: verified above at whatever cost the stored hash actually
            // used. A legacy value is never rewritten except right here, at
            // the one moment the plaintext password is already in hand for a
            // verification that just succeeded. Best-effort: a failed rewrite
            // does not fail a sign-in that has already been proven correct.
            if (needsUpgrade(profile.password_hash)) {
                const upgradedHash = await hashCustomerPassword(password);
                const { error: upgradeError } = await supabase
                    .from('user_profiles')
                    .update({ password_hash: upgradedHash })
                    .eq('id', profile.id);
                if (upgradeError) console.error("Password Upgrade Error:", errorTag(upgradeError));
            }

            await startSession(req, profile.id);

            res.status(200).json({ customer: await publicProfile(profile) });
        } catch (error) {
            console.error("Login Error:", errorTag(error));
            if (error && error.code === 'AUTH_CAPACITY') {
                return sendCapacityRefusal(res);
            }
            res.status(500).json({ error: "Could not sign you in." });
        }
    });

    // ---- Sign out --------------------------------------------------------------
    router.post('/api/auth/logout', (req, res) => {
        if (!req.session) return res.status(200).json({ success: true });

        req.session.destroy((err) => {
            if (err) {
                console.error("Session Destroy Error:", errorTag(err));
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

            if (!profile || await roleNameById(profile.role_id) !== 'customer') {
                return res.status(200).json({ customer: null });
            }

            res.status(200).json({ customer: await publicProfile(profile) });
        } catch (error) {
            console.error("Session Read Error:", errorTag(error));
            res.status(500).json({ error: "Could not read your session." });
        }
    });

    // ---- Edit my details -------------------------------------------------------
    // Writes the profile and the one shipping address together, atomically:
    // migration 039's update_customer_profile_and_address() locks the profile
    // row and writes both tables in one transaction, so this route can no
    // longer leave one half saved and the other not. Both halves are optional:
    // step 02 of signup sends only the address, and Edit Details sends both.
    //
    // email is not editable here and neither is role_id. The address is upserted
    // against the unique index from migration 011, so a customer can never end up
    // with two.
    //
    // F09: this used to validate the address AFTER the profile update had
    // already been written to user_profiles. A new name with an empty
    // address returned 400 for the address and left the name changed behind
    // it — a failure response that did not mean "nothing saved". Every
    // field, profile and address alike, is now checked before the first
    // write. A read of the existing address is not a write and stays where
    // it was, ahead of validation, because merging needs it.
    router.patch('/api/auth/me', requireCustomer, async (req, res) => {
        const body = req.body || {};
        const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

        const profileUpdate = {};
        if (has('name')) {
            const name = trimmed(body.name);
            if (!name) return res.status(400).json({ field: 'name', error: "Enter your name." });
            const lengthError = tooLong('Name', name, MAX_LENGTHS.name);
            if (lengthError) return res.status(400).json({ field: 'name', error: lengthError });
            profileUpdate.full_name = name;
        }
        if (has('phone')) {
            const phone = trimmed(body.phone);
            const digits = normalizePhone(phone);
            const lengthError = tooLong('Phone', phone, MAX_LENGTHS.phone);
            if (lengthError) return res.status(400).json({ field: 'phone', error: lengthError });
            if (digits.length < 7) {
                return res.status(400).json({ field: 'phone', error: "Enter a phone number we can reach you on." });
            }
            profileUpdate.phone_number = phone;
            profileUpdate.phone_normalized = digits;
        }
        if (has('company')) {
            const company = trimmed(body.company);
            const lengthError = tooLong('Company', company, MAX_LENGTHS.company);
            if (lengthError) return res.status(400).json({ field: 'company', error: lengthError });
            profileUpdate.company = company || null;
        }

        const addressKeys = ['address_line', 'city', 'state', 'postal_code', 'country'];
        const touchesAddress = addressKeys.some(has);

        try {
            // A read, not a write — safe to run before every field has
            // passed validation, and what merging the address against what
            // is already saved requires.
            const existing = touchesAddress ? await addressForUser(req.profile.id) : null;

            let merged = null;
            if (touchesAddress) {
                // Merged over what is already saved, so sending only a city does
                // not blank the street. The columns are NOT NULL, so an absent
                // field with nothing behind it becomes '' rather than null.
                // No user_id here — migration 039's RPC takes p_user_id as its
                // own argument and applies it inside the function.
                merged = {
                    full_address: has('address_line') ? trimmed(body.address_line) : (existing ? existing.full_address : ''),
                    city: has('city') ? trimmed(body.city) : (existing ? existing.city : ''),
                    state: has('state') ? trimmed(body.state) : (existing ? existing.state : ''),
                    country: has('country') ? trimmed(body.country) : (existing ? existing.country : ''),
                    zip_code: has('postal_code') ? trimmed(body.postal_code) : (existing ? existing.zip_code : '')
                };

                const addressLengthError = tooLong('Street address', merged.full_address, MAX_LENGTHS.address)
                    || tooLong('City', merged.city, MAX_LENGTHS.city)
                    || tooLong('State', merged.state, MAX_LENGTHS.state)
                    || tooLong('PIN code', merged.zip_code, MAX_LENGTHS.postal_code)
                    || tooLong('Country', merged.country, MAX_LENGTHS.country);
                if (addressLengthError) return res.status(400).json({ error: addressLengthError });

                if (!merged.full_address) {
                    return res.status(400).json({ field: 'address_line', error: "Enter a street address." });
                }
                if (!merged.city) {
                    return res.status(400).json({ field: 'city', error: "Enter a city." });
                }
            }

            // Every supplied field — profile and address — has passed
            // validation. Nothing has been written yet; only now does
            // anything reach the database.
            if (Object.keys(profileUpdate).length) {
                profileUpdate.updated_at = new Date().toISOString();
            }

            // Migration 039 owns the transaction: it locks the profile row
            // `for update` and writes both tables inside it, so a failure
            // partway through (a bad address, a raced unique phone) can never
            // leave the profile half saved and the address half not, or the
            // other way around — the two Supabase calls this used to be could.
            if (Object.keys(profileUpdate).length || merged) {
                const { error } = await supabase.rpc('update_customer_profile_and_address', {
                    p_user_id: req.profile.id,
                    p_profile: Object.keys(profileUpdate).length ? profileUpdate : null,
                    p_address: merged
                });
                if (error) throw error;
            }

            const fresh = await sessionProfile(req);
            res.status(200).json({ customer: await publicProfile(fresh) });
        } catch (error) {
            console.error("Profile Update Error:", errorTag(error));
            if (error && error.code === '23505') {
                return res.status(409).json({ field: 'phone', error: "That phone number is already on another account." });
            }
            res.status(500).json({ error: "Could not save your details." });
        }
    });

    return router;
}

module.exports = { customerAuthController };
