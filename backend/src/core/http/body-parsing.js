/*
 * core/http/body-parsing.js — how a request body becomes req.body
 * ============================================================================
 *
 * Both parsers are exported rather than mounted here, so main.js states the
 * middleware order in one readable list instead of it being spread across
 * eight files that each register themselves as a side effect of being
 * required.
 */
const express = require('express');

// 100kb was the express.json default, and far more than any form here sends.
// The largest legitimate body is a 50-line checkout or a 50-item quote
// request; 64kb clears both with room to spare and halves what an anonymous
// caller can push into a text column per request.
//
// THE `verify` HOOK IS THE WEBHOOK'S ENTIRE SECURITY MODEL.
//
// Razorpay signs the exact bytes it sends. Once this parser has run, req.body
// is an object, and JSON.stringify(req.body) is NOT those bytes — key order
// and whitespace both change across a parse/serialise round trip, so an HMAC
// over the re-serialised body never matches and every delivery fails
// verification.
//
// That failure is dangerous in a specific way: it does not present as a
// security problem, it presents as "webhooks are broken" while a real payment
// sits in the dashboard. The quickest way out of that is to weaken the check,
// and then anyone who guesses the endpoint can post a captured-payment event
// for any order they like.
//
// `verify` runs before parsing and is handed the raw buffer, so the bytes are
// kept once, here, for the one route that needs them. Cheap: 64kb is already
// the ceiling, and this holds a reference rather than a copy.
const jsonBodyParser = express.json({
    limit: '64kb',
    verify: (req, res, buf) => { req.rawBody = buf; }
});

// FORM-ENCODED BODIES, for one reason: the enquiry form has to work without
// JavaScript.
//
// Those forms used to carry action="#", which is not a no-JS fallback — it is
// a form that reloads its own page and silently discards what was typed. The
// enquiry looked sent and went nowhere. They now post to /api/submit-form for
// real, and a browser posting a <form> sends application/x-www-form-urlencoded,
// which express.json does not parse: without this the body would arrive empty
// and a perfectly good enquiry would be refused as "required fields cannot be
// empty".
//
// `extended: false` because these bodies are flat name/value pairs; the
// qs-style nested syntax is surface nothing here needs. Same 64kb ceiling as
// JSON, and the per-field ceilings below still apply — the body limit bounds a
// request, not a column.
const formBodyParser = express.urlencoded({ extended: false, limit: '64kb' });

module.exports = { jsonBodyParser, formBodyParser };
