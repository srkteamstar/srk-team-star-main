/*
 * core/database/supabase.js — the one client, created once
 * ============================================================================
 *
 * A singleton initialised at boot, which is exactly what core/ is for. Every
 * repository in every module imports THIS, and no module may build a client of
 * its own: two clients would mean two connection pools and, worse, two places
 * where somebody could pass the wrong key.
 *
 * The key is the SERVICE ROLE key, which bypasses RLS. That is the whole trust
 * boundary of this application — it is why nothing here is ever handed to a
 * browser, why `frontend/` cannot reach this file, and why the tables that
 * hold customer data carry RLS with no policies at all: the service role is
 * the only thing that reads them, and it reaches them through this module.
 *
 * The test harness replaces `@supabase/supabase-js` at require time, so this
 * file is the seam the in-memory stub is installed at. It must therefore stay
 * a plain `createClient` call with no cleverness around it.
 */
// IMPORTANT: Ensure process.env.SUPABASE_SERVICE_ROLE_KEY is the SECRET role key, not the ANON key.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = { supabase };
