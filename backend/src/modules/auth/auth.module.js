/*
 * modules/auth/auth.module.js - the module registration file
 * ============================================================================
 *
 *
 * Replaces the localStorage stand-in that customer-session-module.js used to
 * be. The tables are user_profiles (contact details) and shipping_addresses
 * (exactly one row per customer, enforced by a unique index in migration
 * 011) — see that file for the schema reasoning.
 *
 * IDENTIFIER-BASED CUSTOMER ACCESS
 * --------------------------------
 * Sign-in resolves an email or phone identifier and starts a customer-scoped
 * session. An account that is not a customer is refused, and told only that.
 * ==========================================
 *
 * Digits only, so "+91 89015 03544", "089015 03544" and "8901503544" all
 * resolve to one account. Written to phone_normalized on every write; the
 * as-typed string stays in phone_number for display and for calling back.
 *
 * The two special cases are India's, because that is the catalogue's market:
 * a 12-digit number starting 91 has the country code on the front, and an
 * 11-digit number starting 0 has the trunk prefix. Anything else is kept
 *
 * WHAT THIS MODULE OWNS
 *   user_profiles as the ACCOUNT, shipping_addresses, and the storefront's
 *   sign-in door.
 *
 *   POST  /api/auth/register
 *   POST  /api/auth/login
 *   POST  /api/auth/logout
 *   GET   /api/auth/me
 *   PATCH /api/auth/me
 *
 * NOTHING HERE CAN RAISE A ROLE, and that is the whole of the boundary.
 * Registration hard-codes the customer role, PATCH /api/auth/me refuses
 * role_id, POST /api/checkout refuses to adopt or create a non-customer
 * profile, and no route or UI grants any other role. Changing somebody's role
 * is a hand edit in the Supabase table editor.
 *
 * READING A SESSION IS NOT THIS MODULE'S JOB. core/security/guards.js does
 * that, and every other module imports it from there. This module is the only
 * one that OPENS a session, which is why the door is here, behind one rate
 * limiter, and why there is exactly one of it.
 */
const express = require('express');
const { customerAuthController } = require('./controllers/customer-auth.controller');

/** @returns {import('express').Router} */
function authModule() {
    const router = express.Router();
    router.use(customerAuthController());
    return router;
}

module.exports = { authModule };
