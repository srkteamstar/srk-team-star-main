/*
 * modules/cart/controllers/cart.controller.js
 * ============================================================================
 *
 *   GET /api/cart   the signed-in customer's saved lines, plus their revision
 *   PUT /api/cart   replace them, wholesale, through one locked RPC
 *
 * EVERY PUT CARRIES THE COMPLETE CART, which is what makes a refused or
 * dropped write cheap: nothing is queued for retry and nothing needs to be,
 * because the next write that lands says everything the lost one would have.
 *
 * THE WRITE IS ATOMIC AND REVISION-CHECKED (migration 036's
 * replace_customer_cart), which it was not before. Three separate, unlocked
 * PostgREST calls — read existing product ids, upsert the new set, delete
 * what is gone — used to let two overlapping PUTs for the same customer
 * interleave, so the OLDER request's write could land LAST and silently
 * revert a newer quantity (audit finding F06). The RPC locks this customer's
 * revision row for the length of the transaction, so a second PUT for the
 * same customer queues behind the first rather than racing it, and a caller
 * whose `revision` no longer matches gets 409 instead of a silent overwrite.
 * `revision` is optional: a client that has never read one yet (its very
 * first save) is not refused for it, exactly as an unconditional write
 * was not before.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireCustomer } = require('../../../core/security/guards');
const { publicCartItem, readCartItems } = require('../domain/cart-line');
const { cartReadLimiter, cartWriteLimiter } = require('../infrastructure/cart-rate-limit');
const { errorTag } = require('../../../shared/error-tag');

/** @returns {import('express').Router} */
function cartController() {
    const router = express.Router();

    // ---- Read ------------------------------------------------------------------
    // Ordered by id, which is insertion order: a line the customer removed and
    // added again gets a new id and moves to the end, which is where they last
    // put it. no-store for the same reason /api/orders/mine sets it — this is one
    // customer's data and must not sit in a shared cache.
    router.get('/api/cart', cartReadLimiter, requireCustomer, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const { data, error } = await supabase
                .from('cart_items')
                .select('*')
                .eq('user_id', req.profile.id)
                .order('id', { ascending: true });

            if (error) throw error;

            // The revision this read reflects. cart-module.js carries it
            // forward on its next PUT so the server can tell a write that
            // started from THIS state apart from one that started stale —
            // see replace_customer_cart() in migration 036. Absent row means
            // revision 0, the same starting point the RPC itself assumes for
            // a customer who has never written a cart before.
            const { data: revRow, error: revError } = await supabase
                .from('cart_revisions')
                .select('revision')
                .eq('user_id', req.profile.id)
                .maybeSingle();
            if (revError) throw revError;

            res.status(200).json({
                items: (data || []).map(publicCartItem),
                revision: revRow ? Number(revRow.revision) : 0
            });
        } catch (error) {
            console.error("Fetch Cart Error:", errorTag(error));
            res.status(500).json({ error: "Could not load your cart." });
        }
    });

    // ---- Replace ---------------------------------------------------------------
    // The whole cart, every time, rather than one route per add / remove / change.
    // The browser holds the cart in memory and is the only thing editing it, so a
    // full replacement is the one write that cannot leave the two disagreeing —
    // and it is what makes a refused or dropped write harmless, since the next one
    // says everything the lost one would have.
    router.put('/api/cart', cartWriteLimiter, requireCustomer, async (req, res) => {
        const parsed = readCartItems(req.body && req.body.items);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const userId = req.profile.id;

        // Optional and on purpose (see the header): a caller that has never
        // read a revision yet is not refused for it. A malformed value is
        // treated the same as absent rather than failing the save — the
        // customer's cart is not the place to be strict about a number the
        // browser is only ever supposed to echo back.
        const rawRevision = req.body && req.body.revision;
        const expectedRevision = Number.isInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null;

        try {
            const { data, error } = await supabase.rpc('replace_customer_cart', {
                p_user_id: userId,
                p_expected_revision: expectedRevision,
                p_items: parsed.items
            });
            if (error) throw error;

            // A newer write already landed for this customer between this
            // browser's last read and this PUT — two tabs, two devices, or a
            // write this same tab lost track of. Refusing rather than
            // overwriting is the whole point of the revision check; the
            // client re-reads GET /api/cart to see what actually won.
            if (data && data.conflict) {
                return res.status(409).json({
                    error: "Your cart changed elsewhere. Reload it and try again.",
                    revision: Number(data.revision)
                });
            }

            // Echoed back normalised, so the browser can adopt exactly what was
            // stored rather than assuming what it sent survived intact — the
            // collapse and the truncations readCartItems() applies both change it.
            res.status(200).json({
                items: (data && data.items || []).map(publicCartItem),
                revision: data ? Number(data.revision) : 0
            });
        } catch (error) {
            console.error("Save Cart Error:", errorTag(error));
            res.status(500).json({ error: "Could not save your cart." });
        }
    });

    return router;
}

module.exports = { cartController };
