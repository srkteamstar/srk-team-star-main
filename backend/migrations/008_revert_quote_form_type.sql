-- =============================================================================
-- 008_revert_quote_form_type.sql — undo 007_quote_form_type.sql
-- =============================================================================
--
-- Run once in the Supabase SQL editor (or psql). Idempotent — safe to re-run.
-- Run this BEFORE 009_quote_requests.sql, or at least before the storefront is
-- redeployed; the two belong to one change.
--
-- WHY
-- ---
-- 007 taught `form_types` a 'quote' row so the store's Request a Quote overlay
-- could post through POST /api/submit-form and land in the `enquiries` table.
-- That worked, but it filed a quote as an enquiry: `enquiries` has exactly one
-- free-text column (`enquirer_text_message`), so the business address, every
-- category/product pair the customer picked and the notes were flattened into
-- one blob of plain text. Nothing downstream could read a quote as a quote —
-- not a query, not a report, not the dashboard, which could only print the blob
-- back out under a column header that says "Issue".
--
-- A quote request is not an enquiry with extra prose in it. It has its own
-- fields and a repeating list of requested products, so it gets its own tables:
-- 009_quote_requests.sql.
--
-- WHAT THIS FILE REMOVES
-- ----------------------
-- The 'quote' row from `form_types`, and only that. Specifically it does NOT:
--
--   * drop `form_types`. 007 created it with `if not exists` and on the live
--     database that was a no-op — the table predates the migrations folder and
--     every enquiry ever stored references it. Dropping it here would destroy
--     data 007 never created.
--
--   * remove the 'enquiry' row. 007 seeds it too, but again as a no-op against
--     the live database, where it already existed and where the contact form
--     and the index-page enquiry form both depend on it. Deleting it would
--     take down two forms this change never touched.
--
--   * touch any row in `enquiries`. Quotes submitted while 007 was live are
--     real customer requests. They stay exactly where they are and keep
--     rendering — see the guard below.
--
-- THE GUARD
-- ---------
-- If any enquiry still points at the 'quote' type, this file deletes nothing
-- and tells you so. Removing the row underneath a live foreign key would either
-- error out or, worse, orphan those enquiries into an untyped state where
-- enquiries.js can no longer tell what they are. Migrate or delete them first,
-- then re-run.
-- =============================================================================

do $$
declare
    quote_id  bigint;
    ref_count bigint;
begin
    select id into quote_id
    from public.form_types
    where lower(type_name) = 'quote'
    limit 1;

    if quote_id is null then
        raise notice '008: no quote form type present — nothing to revert.';
        return;
    end if;

    select count(*) into ref_count
    from public.enquiries
    where enquiry_type_id = quote_id;

    if ref_count > 0 then
        raise notice '008: % enquiry row(s) still reference form_types.id=% — leaving it in place. Re-file or delete those rows, then re-run.', ref_count, quote_id;
        return;
    end if;

    delete from public.form_types where id = quote_id;
    raise notice '008: removed form_types.id=% (quote).', quote_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Check
-- -----------------------------------------------------------------------------
-- Expect 'enquiry' and nothing named 'quote'. If 'quote' is still listed, read
-- the NOTICE this script raised — it says why.
select id, type_name from public.form_types order by id;
