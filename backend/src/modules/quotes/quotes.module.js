/*
 * modules/quotes/quotes.module.js — the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the quote_requests and quote_request_items tables
 *   POST   /api/quote-requests/calculate   anonymous, rate limited preview
 *   POST   /api/quote-requests             anonymous, rate limited
 *
 * A SEPARATE BOUNDED CONTEXT FROM ENQUIRIES, not a variation on it. The two
 * forms collect different things and the difference is structural rather than
 * cosmetic: a quote carries a LIST of requested products, and a list does not
 * fit in a text column. Filing them together meant flattening every requested
 * product into prose — write-only data nobody could count, filter or join.
 *
 * NOT REALTIME, DELIBERATELY. Supabase filters realtime delivery through RLS,
 * so live updates in the dashboard would mean granting the anon role SELECT
 * on a table holding every customer's name, email, phone and business address.
 * quote_requests has RLS on with no policies at all; only the service role
 * reaches it, and only through core/database/supabase.js.
 */
const express = require('express');
const { publicQuotesController } = require('./controllers/public-quotes.controller');

/** @returns {import('express').Router} */
function quotesModule() {
    const router = express.Router();
    router.use(publicQuotesController());
    return router;
}

module.exports = { quotesModule };
