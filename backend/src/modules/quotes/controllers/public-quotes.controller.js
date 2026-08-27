/*
 * modules/quotes/controllers/public-quotes.controller.js
 * ============================================================================
 *
 * POST /api/quote-requests — anonymous, rate limited, and the only write in
 * this application that inserts into two tables without a Postgres function
 * behind it. The header is removed by hand if the items fail, which is the
 * compensating action a real transaction would make unnecessary; migration 025
 * did exactly that for checkout and this route is the remaining candidate.
 * Left as it was, because changing it is a behaviour change and this pass is
 * a structural one.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { EMAIL_PATTERN, MAX_LENGTHS, tooLong, trimmed, optionalId, optionalNumber } = require('../../../shared/validation');
const { MAX_LINE_QUANTITY } = require('../../../core/config/commercial');
const { QUOTE_MAX_ITEMS } = require('../domain/quote-status');
const { quoteReference } = require('../domain/quote-reference');
const { quoteLimiter } = require('../infrastructure/quote-rate-limit');

/** @returns {import('express').Router} */
function publicQuotesController() {
    const router = express.Router();

    router.post('/api/quote-requests', quoteLimiter, async (req, res) => {
        const business_name = trimmed(req.body.business_name);
        const contact_name = trimmed(req.body.contact_name);
        const email = trimmed(req.body.email);
        const phone = trimmed(req.body.phone);
        const business_address = trimmed(req.body.business_address);
        const notes = trimmed(req.body.notes);

        if (!business_name || !contact_name || !email || !business_address) {
            return res.status(400).json({ error: "Business name, contact person, email and business address are required." });
        }

        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ error: "Enter a valid email address." });
        }

        const headerLengthError = tooLong('Business name', business_name, MAX_LENGTHS.name)
            || tooLong('Contact person', contact_name, MAX_LENGTHS.name)
            || tooLong('Email', email, MAX_LENGTHS.email)
            || tooLong('Phone', phone, MAX_LENGTHS.phone)
            || tooLong('Business address', business_address, MAX_LENGTHS.address)
            || tooLong('Notes', notes, MAX_LENGTHS.notes);

        if (headerLengthError) return res.status(400).json({ error: headerLengthError });

        const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
        if (rawItems.length === 0) {
            return res.status(400).json({ error: "Add at least one product to request a quote for." });
        }
        if (rawItems.length > QUOTE_MAX_ITEMS) {
            return res.status(400).json({ error: `A single request can hold at most ${QUOTE_MAX_ITEMS} products.` });
        }

        // `position` is assigned here rather than trusted from the client, so the
        // items can never collide on the (quote_request_id, position) unique index
        // and always read back in the order the customer built them.
        const items = [];
        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i] || {};
            const product_name = trimmed(item.product_name);
            const category_name = trimmed(item.category_name);
            const quantity = Number(item.quantity);

            if (!product_name || !category_name) {
                return res.status(400).json({ error: `Product request #${i + 1} is missing a category or a product.` });
            }

            if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
                return res.status(400).json({ error: `Product request #${i + 1} needs a quantity from 1 to ${MAX_LINE_QUANTITY}.` });
            }

            const itemLengthError = tooLong('Product name', product_name, MAX_LENGTHS.product_name)
                || tooLong('Category name', category_name, MAX_LENGTHS.category_name);

            if (itemLengthError) {
                return res.status(400).json({ error: `Product request #${i + 1}: ${itemLengthError}` });
            }

            items.push({
                position: i + 1,
                category_id: optionalId(item.category_id),
                category_name,
                product_id: optionalId(item.product_id),
                product_name,
                product_price: optionalNumber(item.product_price),
                quantity
            });
        }

        let insertedId = null;

        try {
            const { data: header, error: headerError } = await supabase
                .from('quote_requests')
                .insert([{
                    business_name,
                    contact_name,
                    email,
                    phone: phone || null,
                    business_address,
                    notes: notes || null,
                    status: 'Open'
                }])
                .select('id, created_at')
                .single();

            if (headerError) throw headerError;
            insertedId = header.id;

            const { error: itemsError } = await supabase
                .from('quote_request_items')
                .insert(items.map(item => ({ ...item, quote_request_id: header.id })));

            // A header with no items is a quote for nothing — it would show up in
            // the dashboard as a request staff cannot act on. Postgres has no
            // transaction to roll back across two PostgREST calls, so the header is
            // removed by hand and the customer is told to try again.
            if (itemsError) throw itemsError;

            res.status(200).json({
                success: true,
                id: header.id,
                reference: quoteReference(header.id, header.created_at)
            });
        } catch (error) {
            console.error("Database Error (Quote Insert):", error);

            if (insertedId !== null) {
                const { error: cleanupError } = await supabase
                    .from('quote_requests')
                    .delete()
                    .eq('id', insertedId);
                if (cleanupError) console.error("Cleanup failed for orphaned quote request:", insertedId, cleanupError);
            }

            res.status(500).json({ error: "An error occurred while saving your quote request." });
        }
    });

    return router;
}

module.exports = { publicQuotesController };
