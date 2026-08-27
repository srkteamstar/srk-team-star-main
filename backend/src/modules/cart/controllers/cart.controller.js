/*
 * modules/cart/controllers/cart.controller.js
 * ============================================================================
 *
 *   GET /api/cart   the signed-in customer's saved lines
 *   PUT /api/cart   replace them, wholesale
 *
 * EVERY PUT CARRIES THE COMPLETE CART, which is what makes a refused or
 * dropped write cheap: nothing is queued for retry and nothing needs to be,
 * because the next write that lands says everything the lost one would have.
 *
 * THE WRITE IS NOT ATOMIC, and the ORDER of its two halves is load-bearing.
 * It is an upsert followed by a delete of what is no longer in the cart, and
 * one can land without the other. This way round, a failure in between leaves
 * a line the customer had removed - which the very next write clears. The
 * other way round it deletes lines they still have and never puts them back.
 * Cheap to get wrong in only one direction, so it is written in that
 * direction.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireCustomer } = require('../../../core/security/guards');
const { publicCartItem, readCartItems } = require('../domain/cart-line');
const { cartReadLimiter, cartWriteLimiter } = require('../infrastructure/cart-rate-limit');

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

            res.status(200).json({ items: (data || []).map(publicCartItem) });
        } catch (error) {
            console.error("Fetch Cart Error:", error);
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

        try {
            const { data: existing, error: readError } = await supabase
                .from('cart_items')
                .select('product_id')
                .eq('user_id', userId);

            if (readError) throw readError;

            const keeping = new Set(parsed.items.map(item => String(item.product_id)));
            const gone = (existing || [])
                .map(row => row.product_id)
                .filter(id => !keeping.has(String(id)));

            // UPSERT BEFORE DELETE, and the order is load-bearing. PostgREST has
            // no multi-statement transaction — the same limit the order write
            // documents — so one of these can land without the other. This way
            // round, a failure in between leaves a line the customer had removed,
            // which the very next write clears. The other way round it deletes
            // lines the customer still has and never puts them back.
            if (parsed.items.length) {
                const { error: writeError } = await supabase
                    .from('cart_items')
                    .upsert(
                        parsed.items.map(item => Object.assign({ user_id: userId }, item)),
                        { onConflict: 'user_id,product_id' }
                    );

                if (writeError) throw writeError;
            }

            if (gone.length) {
                const { error: deleteError } = await supabase
                    .from('cart_items')
                    .delete()
                    .eq('user_id', userId)
                    .in('product_id', gone);

                if (deleteError) throw deleteError;
            }

            // Echoed back normalised, so the browser can adopt exactly what was
            // stored rather than assuming what it sent survived intact — the
            // collapse and the truncations above both change it.
            res.status(200).json({ items: parsed.items.map(publicCartItem) });
        } catch (error) {
            console.error("Save Cart Error:", error);
            res.status(500).json({ error: "Could not save your cart." });
        }
    });

    return router;
}

module.exports = { cartController };
