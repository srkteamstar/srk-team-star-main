const rateLimit = require('express-rate-limit');
const { supabase } = require('../database/supabase');
const { isProduction } = require('../config/runtime');

class SupabaseRateLimitStore {
    constructor(prefix) {
        this.prefix = prefix;
        this.localKeys = false;
        this.windowMs = 0;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    key(key) {
        return `${this.prefix}:${key}`;
    }

    async increment(key) {
        const { data, error } = await supabase.rpc('consume_storefront_rate_limit', {
            p_key: this.key(key),
            p_window_ms: this.windowMs
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error('Rate-limit store returned no result.');
        return { totalHits: Number(row.total_hits), resetTime: new Date(row.reset_at) };
    }

    async decrement(key) {
        const { error } = await supabase.rpc('decrement_storefront_rate_limit', { p_key: this.key(key) });
        if (error) throw error;
    }

    async resetKey(key) {
        const { error } = await supabase.from('storefront_rate_limits').delete().eq('key', this.key(key));
        if (error) throw error;
    }
}

function storefrontRateLimit(prefix, options) {
    return rateLimit(Object.assign({}, options, isProduction ? {
        store: new SupabaseRateLimitStore(prefix)
    } : {}));
}

module.exports = { SupabaseRateLimitStore, storefrontRateLimit };
