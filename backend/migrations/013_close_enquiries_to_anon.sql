-- =============================================================================
-- 013_close_enquiries_to_anon.sql — stop publishing every contact-form
-- submission to the public internet
-- =============================================================================
--
-- Run any time. Idempotent — safe to re-run.
--
-- WHAT WAS WRONG
-- --------------
-- `enquiries` had a policy granting the `anon` role SELECT. That role's key is
-- the Supabase anon key, which is *published* — it sits in plain text in
-- enquiries.js, which the static middleware serves at /enquiries.js to
-- anybody who asks. So this was true of the live database:
--
--     curl 'https://<project>.supabase.co/rest/v1/enquiries?select=*' \
--          -H "apikey: <the key from /enquiries.js>"
--
-- returned every row: enquirer_name, enquirer_email, enquirer_phone_number,
-- enquirer_business_name and the full enquirer_text_message of every person
-- who has ever used the contact form. Verified against the live project
-- during the audit — six rows of real customer contact details, readable by
-- anyone, with no login of any kind.
--
-- Writes were already blocked (a no-op anonymous UPDATE affected 0 rows), so
-- this was disclosure only, not tampering or data loss.
--
-- WHY THE POLICY EXISTED
-- ----------------------
-- Not carelessness — it was load-bearing. enquiries.js subscribed to the
-- table's changes over Supabase Realtime straight from the browser, using the
-- anon key, and **Realtime delivers through RLS**: no anon SELECT policy, no
-- live updates. The policy was the price of the feature.
--
-- 009_quote_requests.sql had already reached the opposite conclusion for
-- quote_requests and wrote it down: "the same live updates here would mean
-- granting anon SELECT on quote_requests — publishing every customer name,
-- email, phone and business address to anyone who opens devtools", so that
-- table is closed and quotations.js refetches instead. enquiries.js simply
-- predates that reasoning. This migration applies the same conclusion to the
-- older table.
--
-- THE OTHER HALF OF THIS FIX IS IN THE CLIENT
-- -------------------------------------------
-- Closing the table breaks the Realtime subscription, so enquiries.js has to
-- stop using it — and does, in the same change: it now polls
-- GET /api/enquiries through window.adminAuth.fetch, which is
-- session-authenticated and service-role-backed. Running this migration
-- without that change would leave the Technical Support tab silently
-- never updating. Deploy them together.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Remove every policy on the table.
--
--    Dropped by name from the catalogue rather than by a guessed literal,
--    because the policy was created by hand in the Supabase dashboard and its
--    name is whatever was typed that day.
-- -----------------------------------------------------------------------------
do $$
declare
    pol record;
begin
    for pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = 'enquiries'
    loop
        execute format('drop policy if exists %I on public.enquiries', pol.policyname);
        raise notice 'dropped policy % on public.enquiries', pol.policyname;
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 2. RLS on, no policies — closed to every role except the service role, which
--    bypasses RLS. That is the posture quote_requests, user_profiles and the
--    order tables already use.
-- -----------------------------------------------------------------------------
alter table public.enquiries enable row level security;


-- -----------------------------------------------------------------------------
-- 3. Belt and braces: take the table privileges away too.
--
--    RLS and GRANTs are separate mechanisms, and leaving a stale GRANT behind
--    means the next person who adds a permissive policy re-opens the table
--    without realising a grant was already waiting for it.
--
--    The backend reads and writes this table with the service role, which is
--    unaffected — but make that grant explicit rather than assumed, since
--    section 4 of migration 010 documents how a table created from the table
--    editor grants nothing by default.
-- -----------------------------------------------------------------------------
revoke all on public.enquiries from anon;
revoke all on public.enquiries from authenticated;

grant select, insert, update, delete on public.enquiries to service_role;

do $$
begin
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'S' and n.nspname = 'public' and c.relname = 'enquiries_id_seq'
    ) then
        grant usage, select on sequence public.enquiries_id_seq to service_role;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. form_types is readable by anon too. That one is deliberate and harmless —
--    it holds nothing but the type names ('enquiry', 'technical') and no
--    personal data — but the contact form does not read it from the browser
--    either, so close it as well rather than leave an unused door open.
-- -----------------------------------------------------------------------------
do $$
declare
    pol record;
begin
    for pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = 'form_types'
    loop
        execute format('drop policy if exists %I on public.form_types', pol.policyname);
    end loop;
end $$;

alter table public.form_types enable row level security;
revoke all on public.form_types from anon;
revoke all on public.form_types from authenticated;
grant select, insert, update, delete on public.form_types to service_role;


-- -----------------------------------------------------------------------------
-- 5. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select tablename, policyname from pg_policies
--  where schemaname='public' and tablename in ('enquiries','form_types');
-- Expected: no rows.
--
-- select relname, relrowsecurity from pg_class
--  where relname in ('enquiries','form_types');
-- Expected: relrowsecurity = true for both.
--
-- Then, from a terminal, with the anon key out of /enquiries.js:
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     'https://<project>.supabase.co/rest/v1/enquiries?select=*' \
--     -H 'apikey: <anon key>' -H 'Authorization: Bearer <anon key>'
-- Expected: 401. It returned 200 with every row before this migration.
--
-- And the dashboard's Technical Support tab must still list and update
-- enquiries — it reads GET /api/enquiries with the admin session now, not
-- PostgREST with the anon key.
-- =============================================================================
