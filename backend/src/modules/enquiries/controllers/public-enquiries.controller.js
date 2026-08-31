/*
 * modules/enquiries/controllers/public-enquiries.controller.js
 * ============================================================================
 *
 * `POST /api/submit-form` — the one anonymous write in this module, reached by
 * the enquiry form on ten pages through public/js/modules/enquiries.
 *
 * THIS HANDLER IS NOT THIN, and that is deliberate rather than an oversight.
 * It is one insert with a validation preamble and a single documented retry
 * for the window before migration 027 is applied; splitting it into a service
 * would move the retry away from the comment explaining when to delete it,
 * which is the only thing keeping that block from becoming permanent.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong } = require('../../../shared/validation');
const { formLimiter } = require('../infrastructure/enquiry-rate-limit');
const { wantsRedirect, enquiryRedirect } = require('../services/enquiry-redirect.service');

/** @returns {import('express').Router} */
function publicEnquiriesController() {
    const router = express.Router();

    router.post('/api/submit-form', formLimiter, async (req, res) => {
        // F10: this used to destructure req.body and call .trim() on whatever
        // came out before any of it was checked. A body that was not an
        // object at all threw before the first line finished; a numeric name
        // survived the optional-chain (`42?.trim` reads as "is not a
        // function", not "is missing") and crashed the same way one property
        // later — both straight into Express's default HTML error page
        // instead of the JSON 400 every other bad submission here gets.
        // Shape and type are checked before a single string method runs.
        const body = req.body;
        const wrongType = (value) => value !== undefined && value !== null && typeof value !== 'string';

        if (!body || typeof body !== 'object' || Array.isArray(body)
            || wrongType(body.form_type) || wrongType(body.full_name) || wrongType(body.company)
            || wrongType(body.email) || wrongType(body.phone) || wrongType(body.message)) {
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
            return res.status(400).json({ error: "Required fields (Name, Email, Message) cannot be empty." });
        }

        const { form_type, full_name, company, email, phone, message } = body;

        if (!full_name?.trim() || !email?.trim() || !message?.trim() || !form_type?.trim()) {
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
            return res.status(400).json({ error: "Required fields (Name, Email, Message) cannot be empty." });
        }

        // Quotes moved to their own tables and their own route. The 'quote' row is
        // gone from `form_types` (008), so this would otherwise fail the type lookup
        // below and surface as a generic 500 — this says what actually happened, for
        // anyone running an old cached copy of request-quote-module.js.
        if (form_type.trim().toLowerCase() === 'quote') {
            return res.status(410).json({ error: "Quote requests are submitted to /api/quote-requests. Reload the page and try again." });
        }

        // Length ceilings and an email that is actually an email. Neither was
        // checked here, so an anonymous caller set the size of every text column
        // in the row, and staff could receive an enquiry with no reachable
        // address on it. EMAIL_PATTERN is the same test the quote and auth routes
        // already apply; there was no reason this one was the exception.
        const lengthError = tooLong('Name', full_name, MAX_LENGTHS.name)
            || tooLong('Company', company, MAX_LENGTHS.company)
            || tooLong('Email', email, MAX_LENGTHS.email)
            || tooLong('Phone', phone, MAX_LENGTHS.phone)
            || tooLong('Message', message, MAX_LENGTHS.message);

        if (lengthError) {
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
            return res.status(400).json({ error: lengthError });
        }

        if (!EMAIL_PATTERN.test(email.trim())) {
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
            return res.status(400).json({ error: "Enter a valid email address." });
        }

        // STORED AS TYPED, not as an integer. Migration 027 converts this column
        // from int8 to text and drops its NOT NULL — the TODO that used to sit
        // here, now done, plus a live bug it was hiding.
        //
        // The int8 lost information on the way in: `parseInt` on the digits alone
        // dropped a leading zero, could not hold a `+` country code, and threw
        // away every space and hyphen the visitor typed. A phone number is a
        // label; nothing adds two of them together. `quote_requests.phone` has
        // been `text` since 009 and this brings the older table into line.
        //
        // The digits are still what is VALIDATED — a value with no digit in it is
        // not a phone number whatever else it contains — but the original string
        // is what gets written.
        let sanitizedPhone = null;
        if (phone && phone.trim() !== '') {
            const digits = phone.toString().replace(/\D/g, '');
            if (digits.length === 0) {
                if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
                return res.status(400).json({ error: "Invalid phone format." });
            }
            sanitizedPhone = phone.trim();
        }

        try {
            const { data: typeData, error: typeError } = await supabase
                .from('form_types')
                .select('id')
                .eq('type_name', form_type.trim())
                .single();

            if (typeError || !typeData) throw new Error("Invalid form type submitted.");

            // .select('id') so the response can carry the row's own primary key back.
            // The store's Request a Quote overlay turns it into the reference number
            // on its confirmation screen (PI-<year>-<id>), which means the number a
            // customer quotes when following up is the row staff will actually find.
            // PostgREST returns the representation in the same round trip, so this is
            // not a second query and cannot half-succeed. Older callers — the contact
            // and index page enquiry forms — simply ignore the extra field.
            const enquiryRow = (phoneValue) => ({
                enquiry_type_id: typeData.id,
                enquirer_name: full_name.trim(),
                enquirer_business_name: company?.trim() || null,
                enquirer_email: email.trim(),
                enquirer_phone_number: phoneValue,
                enquirer_text_message: message.trim(),
                status: 'Open'
            });

            let { data: inserted, error: insertError } = await supabase
                .from('enquiries')
                .insert([enquiryRow(sanitizedPhone)])
                .select('id')
                .single();

            // ONE RETRY, FOR THE WINDOW BEFORE MIGRATION 027 IS RUN.
            //
            // 027 converts `enquirer_phone_number` from int8 to text. Against the
            // OLD column a typed number like "+91 89015 03544" is not a valid
            // integer and Postgres answers 22P02, so writing what the visitor
            // typed would break the one enquiry path that currently works — a
            // migration nobody has run yet is not a reason to lose an enquiry.
            //
            // So a type refusal, and only a type refusal, is retried once with the
            // digits alone: exactly what this route used to store, and what the
            // old column can hold. It costs one round trip on a database that has
            // not been migrated and nothing at all on one that has.
            //
            // It cannot paper over the other half of the bug: a phone-less enquiry
            // is null on both schemas, and the old column's NOT NULL refuses it
            // with 23502 whatever this does. That is the failure 027 exists to
            // fix, and it stays visible until the migration is run.
            //
            // DELETE THIS BLOCK once 027 has been applied everywhere.
            if (insertError && insertError.code === '22P02' && sanitizedPhone !== null) {
                const digits = sanitizedPhone.replace(/\D/g, '');
                console.warn('Enquiries: enquirer_phone_number still int8 — run migration 027. Falling back to digits only.');
                ({ data: inserted, error: insertError } = await supabase
                    .from('enquiries')
                    .insert([enquiryRow(digits.length ? Number(digits) : null)])
                    .select('id')
                    .single());
            }

            if (insertError) throw insertError;
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'sent');

            res.status(200).json({
                success: true,
                id: inserted ? inserted.id : null,
                message: "Enquiry submitted successfully!"
            });
        } catch (error) {
            // S01: not the raw error — a Postgres error's message can echo the
            // offending value back (a unique-violation, for one, often names
            // it), and this route's whole input is a stranger's name, email,
            // phone and message. The short code is enough to triage from.
            console.error("Database Error (Insert):", error && error.code);
            if (wantsRedirect(req)) return enquiryRedirect(req, res, 'failed');
            res.status(500).json({ error: "An error occurred while saving your submission." });
        }
    });

    return router;
}

module.exports = { publicEnquiriesController };
