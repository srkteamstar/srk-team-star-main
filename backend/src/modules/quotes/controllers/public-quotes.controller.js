/*
 * modules/quotes/controllers/public-quotes.controller.js
 * ============================================================================
 *
 * POST /api/quote-requests/calculate resolves ids against the catalogue and
 * returns a live estimate. POST /api/quote-requests resolves the same ids again
 * and saves that second, authoritative result atomically through migration 029.
 * The browser never names a product, category, tax rate or price.
 */
const express = require('express');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong, trimmed } = require('../../../shared/validation');
const { quoteReference } = require('../domain/quote-reference');
const { calculateQuote } = require('../services/calculate-quote.service');
const { saveQuoteRequest } = require('../services/save-quote-request.service');
const { quoteLimiter, quoteCalculationLimiter } = require('../infrastructure/quote-rate-limit');

function requestHeader(body) {
    const header = {
        business_name: trimmed(body.business_name),
        contact_name: trimmed(body.contact_name),
        email: trimmed(body.email),
        phone: trimmed(body.phone),
        business_address: trimmed(body.business_address),
        notes: trimmed(body.notes)
    };

    if (!header.business_name || !header.contact_name || !header.email || !header.business_address) {
        return { ok: false, error: 'Business name, contact person, email and business address are required.' };
    }
    if (!EMAIL_PATTERN.test(header.email)) {
        return { ok: false, error: 'Enter a valid email address.' };
    }

    const lengthError = tooLong('Business name', header.business_name, MAX_LENGTHS.name)
        || tooLong('Contact person', header.contact_name, MAX_LENGTHS.name)
        || tooLong('Email', header.email, MAX_LENGTHS.email)
        || tooLong('Phone', header.phone, MAX_LENGTHS.phone)
        || tooLong('Business address', header.business_address, MAX_LENGTHS.address)
        || tooLong('Notes', header.notes, MAX_LENGTHS.notes);

    return lengthError ? { ok: false, error: lengthError } : { ok: true, header };
}

function snapshotFor(reference, createdAt, header, priced) {
    return {
        reference,
        created_at: createdAt,
        customer: {
            business_name: header.business_name,
            contact_name: header.contact_name,
            email: header.email,
            phone: header.phone || null,
            business_address: header.business_address
        },
        notes: header.notes || null,
        calculation_version: priced.calculation_version,
        calculated_at: priced.calculated_at,
        commercial_basis: priced.commercial_basis,
        delivery_included: priced.delivery_included,
        lines: priced.lines,
        totals: priced.totals
    };
}

/** @returns {import('express').Router} */
function publicQuotesController() {
    const router = express.Router();

    router.post('/api/quote-requests/calculate', quoteCalculationLimiter, async (req, res) => {
        try {
            const priced = await calculateQuote(req.body && req.body.items);
            if (!priced.ok) return res.status(400).json({ error: priced.error });
            res.status(200).json(priced);
        } catch (error) {
            console.error('Quote calculation error:', error);
            res.status(500).json({ error: 'The quote could not be calculated right now.' });
        }
    });

    router.post('/api/quote-requests', quoteLimiter, async (req, res) => {
        const checkedHeader = requestHeader(req.body || {});
        if (!checkedHeader.ok) return res.status(400).json({ error: checkedHeader.error });

        try {
            // Resolve again at finalisation. A live preview can be minutes old;
            // the saved snapshot must reflect the catalogue at the write.
            const priced = await calculateQuote(req.body && req.body.items);
            if (!priced.ok) return res.status(400).json({ error: priced.error });
            if (!priced.can_submit) {
                return res.status(400).json({
                    error: 'One or more selected products are no longer available. Review the highlighted lines and try again.',
                    calculation: priced
                });
            }

            const header = checkedHeader.header;
            const saved = await saveQuoteRequest(
                {
                    business_name: header.business_name,
                    contact_name: header.contact_name,
                    email: header.email,
                    phone: header.phone || null,
                    business_address: header.business_address,
                    notes: header.notes || null,
                    status: 'Open',
                    currency: priced.totals.currency,
                    commercial_basis: priced.commercial_basis,
                    pricing_complete: priced.totals.pricing_complete,
                    subtotal: priced.totals.priced_subtotal,
                    discount_amount: priced.totals.discount_amount,
                    tax_amount: priced.totals.tax_amount,
                    total: priced.totals.estimated_total,
                    calculation_version: priced.calculation_version,
                    calculated_at: priced.calculated_at
                },
                priced.lines.map(line => ({
                    position: line.position,
                    category_id: line.category_id,
                    category_name: line.category_name,
                    product_id: line.product_id,
                    product_name: line.product_name,
                    product_price: line.unit_price,
                    quantity: line.quantity,
                    unit_price: line.unit_price,
                    discount_amount: line.discount_amount,
                    taxable_value: line.taxable_value,
                    gst_rate: line.gst_rate,
                    gst_amount: line.gst_amount,
                    line_total: line.line_total,
                    pricing_status: line.pricing_status
                }))
            );

            const record = saved.record;
            if (!record || record.id === null || record.id === undefined) {
                throw new Error('create_quote_request returned no request id');
            }

            const reference = quoteReference(record.id, record.created_at);
            res.status(200).json({
                success: true,
                id: record.id,
                reference,
                snapshot: snapshotFor(reference, record.created_at, header, priced)
            });
        } catch (error) {
            console.error('Database Error (Quote Insert):', error);
            res.status(500).json({ error: 'An error occurred while saving your quote request.' });
        }
    });

    return router;
}

module.exports = { publicQuotesController };
