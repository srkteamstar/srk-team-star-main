const session = require('express-session');
const { supabase } = require('../database/supabase');

class SupabaseSessionStore extends session.Store {
    get(sid, callback) {
        supabase.from('storefront_sessions')
            .select('data, expires_at')
            .eq('sid', sid)
            .maybeSingle()
            .then(async ({ data, error }) => {
                if (error) return callback(error);
                if (!data) return callback(null, null);
                if (new Date(data.expires_at).getTime() <= Date.now()) {
                    await supabase.from('storefront_sessions').delete().eq('sid', sid);
                    return callback(null, null);
                }
                callback(null, data.data);
            })
            .catch(callback);
    }

    set(sid, value, callback) {
        const expiresAt = value.cookie && value.cookie.expires
            ? new Date(value.cookie.expires)
            : new Date(Date.now() + (value.cookie && value.cookie.maxAge || 30 * 24 * 60 * 60 * 1000));

        supabase.from('storefront_sessions').upsert({
            sid,
            data: value,
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'sid' }).then(({ error }) => callback(error || null)).catch(callback);
    }

    destroy(sid, callback) {
        supabase.from('storefront_sessions').delete().eq('sid', sid)
            .then(({ error }) => callback(error || null)).catch(callback);
    }

    touch(sid, value, callback) {
        const expiresAt = value.cookie && value.cookie.expires
            ? new Date(value.cookie.expires)
            : new Date(Date.now() + (value.cookie && value.cookie.maxAge || 30 * 24 * 60 * 60 * 1000));

        supabase.from('storefront_sessions').update({
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
        }).eq('sid', sid).then(({ error }) => callback(error || null)).catch(callback);
    }
}

module.exports = { SupabaseSessionStore };
