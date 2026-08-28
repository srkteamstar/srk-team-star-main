/*
 * Saves a quote request through migration 029's atomic database function.
 *
 * The deployed database may briefly lag the application during a rollout. If
 * and only if PostgREST says that exact function is missing, use the schema
 * that migrations 009 + 026 already guarantee. That compatibility write is
 * server-side, still ignores browser prices, and compensates by deleting the
 * header if its child rows fail. Once 029 is applied, every request takes the
 * atomic function path automatically.
 */
const { supabase } = require('../../../core/database/supabase');

function isMissingAtomicFunction(error) {
    return Boolean(
        error && error.code === 'PGRST202' &&
        String(error.message || '').includes('create_quote_request')
    );
}

async function legacyCompatibleWrite(request, items) {
    const header = {
        business_name: request.business_name,
        contact_name: request.contact_name,
        email: request.email,
        phone: request.phone,
        business_address: request.business_address,
        notes: request.notes,
        status: request.status || 'Open'
    };

    const created = await supabase.from('quote_requests')
        .insert([header])
        .select('id, created_at')
        .single();
    if (created.error) throw created.error;

    const itemRows = items.map(item => ({
        quote_request_id: created.data.id,
        position: item.position,
        category_id: item.category_id,
        category_name: item.category_name,
        product_id: item.product_id,
        product_name: item.product_name,
        product_price: item.product_price,
        quantity: item.quantity
    }));

    const inserted = await supabase.from('quote_request_items').insert(itemRows);
    if (!inserted.error) return created.data;

    // Migration 009's FK cascades this cleanup to any child row a database
    // happened to accept before rejecting a later one. A cleanup failure is
    // logged separately; the original insert error is still what the caller
    // reports because it is the cause of the failed customer request.
    const cleanup = await supabase.from('quote_requests').delete().eq('id', created.data.id);
    if (cleanup.error) {
        console.error('Quote compatibility cleanup failed for request', created.data.id, cleanup.error);
    }
    throw inserted.error;
}

async function saveQuoteRequest(request, items) {
    const atomic = await supabase.rpc('create_quote_request', {
        p_request: request,
        p_items: items
    });

    if (!atomic.error) {
        const record = Array.isArray(atomic.data) ? atomic.data[0] : atomic.data;
        return { record, storage_mode: 'atomic_snapshot' };
    }
    if (!isMissingAtomicFunction(atomic.error)) throw atomic.error;

    console.warn(
        'Migration 029 is not applied: saving this quote through the migrations 009/026 compatibility path.'
    );
    const record = await legacyCompatibleWrite(request, items);
    return { record, storage_mode: 'legacy_compatible' };
}

module.exports = { saveQuoteRequest, isMissingAtomicFunction };
