/*
 * core/database/postgrest-errors.js — reading the adapter's error shapes
 * ============================================================================
 *
 * These say what a Supabase/PostgREST failure MEANS, and nothing about any
 * particular table. They live in core rather than in a feature module because
 * two modules read them (products and categories) and because they describe
 * the persistence adapter, which is core's to own — the same reasoning that
 * puts the client itself next door in supabase.js.
 *
 * Each one exists because the failure it names is expected and recoverable:
 * a migration that has not been run yet, a column added later, or the RLS-
 * bypass-is-not-a-grant trap that 001_categories.sql section 5 documents.
 */
// PostgREST reports an unknown table as PGRST205/PGRST202 (schema cache miss),
// Postgres itself as 42P01. Until the migration runs, that is the expected state.
function isMissingRelation(error) {
    if (!error) return false;
    return error.code === '42P01'
        || error.code === 'PGRST205'
        || error.code === 'PGRST202'
        || /relation .* does not exist|could not find the table/i.test(error.message || '');
}

// A `products` table already exists in this project but predates these routes, so
// the common failure is a missing *column*, not a missing table. Kept separate so
// the admin is told which column rather than "the table does not exist".
function isMissingColumn(error) {
    return !!error && (error.code === 'PGRST204' || error.code === '42703');
}

// The trap section 5 of 001_categories.sql documents: the service role bypasses
// RLS but still needs table privileges granted explicitly.
function isPermissionDenied(error) {
    return !!error && (error.code === '42501' || /permission denied/i.test(error.message || ''));
}

module.exports = { isMissingRelation, isMissingColumn, isPermissionDenied };
