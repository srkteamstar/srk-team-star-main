/*
 * modules/enquiries/enquiries.module.js — the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the `enquiries` and `form_types` tables
 *   POST   /api/submit-form            anonymous, rate limited, no-JS capable
 *
 * WHAT IT DEPENDS ON
 *   core/database/supabase, core/security/guards, shared/validation
 *   and NOTHING from a sibling module.
 *
 * QUOTES ARE NOT ENQUIRIES, which is why they are a different module rather
 * than a branch in this one. A quote carries a repeating list of products and
 * a list does not fit in a column; filing quotes here meant flattening every
 * requested product into `enquirer_text_message` as prose. `/api/submit-form`
 * still answers 410 to a form type of "quote" so that a browser holding a
 * cached copy of the old browser module is told to reload rather than handed
 * a 500 from a `form_types` row that no longer exists.
 */
const express = require('express');
const { publicEnquiriesController } = require('./controllers/public-enquiries.controller');

/** @returns {import('express').Router} */
function enquiriesModule() {
    const router = express.Router();
    router.use(publicEnquiriesController());
    return router;
}

module.exports = { enquiriesModule };
