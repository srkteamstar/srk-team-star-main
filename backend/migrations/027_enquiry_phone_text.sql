-- =============================================================================
-- 027_enquiry_phone_text.sql — the enquiry phone column, fixed twice over
-- =============================================================================
--
-- RUN THIS. Unlike 020 and 023 it is neither destructive nor optional: without
-- it, the enquiry form on every public page is BROKEN for the common case.
--
-- WHAT IS WRONG TODAY
-- ---------------------------------------------------------------------------
-- `enquiries.enquirer_phone_number` is `int8 NOT NULL`, and phone is an
-- OPTIONAL field on all ten enquiry forms. `POST /api/submit-form` passes null
-- when it is left blank, exactly as it should, and Postgres refuses the row:
--
--     23502  null value in column "enquirer_phone_number" of relation
--            "enquiries" violates not-null constraint
--
-- The visitor is told "An error occurred while saving your submission." Every
-- enquiry from anyone who did not volunteer a phone number has been lost this
-- way. Reproduced against the live project while consolidating the five form
-- implementations into one — it is not a regression from that work, it is what
-- that work uncovered.
--
-- The `int8` half is the bug `server.js` has carried an inline TODO about for
-- as long as the column has existed, and it is the same one migration 011
-- fixed on `user_profiles.phone_number`:
--
--   * a leading zero is silently dropped     089015 03544 -> 8901503544
--   * a country code cannot be stored at all           +91 ... -> rejected
--   * spaces, hyphens and parentheses are unrepresentable
--
-- A phone number is a LABEL, not a quantity. Nothing adds two of them together.
-- `quote_requests.phone` was declared `text` for this reason in 009, and this
-- brings the older table into line with it rather than leaving two tables
-- disagreeing about what a phone number is.
--
-- WHAT THIS DOES
-- ---------------------------------------------------------------------------
--   1. drops the NOT NULL, because the field is genuinely optional;
--   2. converts int8 -> text, so future rows keep what the visitor typed;
--   3. leaves every existing value exactly as it reads today.
--
-- Step 3 is worth being precise about: an int8 of 8901503544 becomes the text
-- '8901503544'. The leading zero that was lost on the way IN cannot be
-- recovered — that information is gone and this migration does not invent it.
-- What it does is stop the next one being lost.
--
-- REVERSIBLE? Not cleanly, and deliberately not attempted. Going back to int8
-- would fail on any row holding a '+' or a space, which is precisely the data
-- this exists to allow. Take a backup first if that matters to you.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. REFUSE IF A STORED VALUE WOULD NOT SURVIVE THE TRIP
-- ---------------------------------------------------------------------------
-- The conversion below is total for int8 (every integer has a text form), so
-- this cannot actually fire today. It is here because the same file would be
-- run again unchanged if the column were ever widened to numeric by hand, and
-- a silent truncation of a phone number is precisely the class of failure the
-- whole migration is about. Same shape as section 1 of 020: check the rows
-- that are actually there rather than trusting an argument about them.
do $$
declare
    v_type text;
begin
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enquiries'
      and column_name = 'enquirer_phone_number';

    if v_type is null then
        raise exception 'enquiries.enquirer_phone_number does not exist — is this the right database?';
    end if;

    if v_type = 'text' then
        raise notice '027: enquirer_phone_number is already text; only the NOT NULL is being reconsidered.';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE COLUMN
-- ---------------------------------------------------------------------------
alter table public.enquiries
    alter column enquirer_phone_number drop not null;

alter table public.enquiries
    alter column enquirer_phone_number type text
    using nullif(trim(enquirer_phone_number::text), '');

-- A stored empty string is a third state meaning the same thing as null, and
-- three states for "we do not have a phone number" is two too many. The route
-- already sends null rather than '', so this only normalises anything a hand
-- edit left behind.
update public.enquiries
   set enquirer_phone_number = null
 where enquirer_phone_number = '';

-- A ceiling, matching MAX_LENGTHS.phone in server.js. The body limit bounds a
-- request, not a column — the same reasoning behind every other field ceiling
-- on the anonymous write routes.
alter table public.enquiries
    drop constraint if exists enquiries_phone_length_check;

alter table public.enquiries
    add constraint enquiries_phone_length_check
    check (enquirer_phone_number is null or char_length(enquirer_phone_number) <= 32);

comment on column public.enquiries.enquirer_phone_number is
    'Optional contact number, stored as typed. text (not int8) so a leading zero, a + country code and separators all survive — see migration 027.';

-- ---------------------------------------------------------------------------
-- 3. GRANTS ARE NOT IMPLIED BY AN RLS BYPASS
-- ---------------------------------------------------------------------------
-- The trap 001, 011, 012, 014, 015 and 016 each document in turn. 013 closed
-- this table to anon and revoked its grants, which is right and stays; the
-- service role's own privileges are re-asserted here because a column type
-- change is exactly the kind of edit that has silently dropped them before.
grant select, insert, update on public.enquiries to service_role;

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- AFTERWARDS
-- =============================================================================
-- Restart the backend (server.js is loaded into memory once at boot) and send
-- an enquiry with the phone field left EMPTY from any public page. It should
-- succeed. Before this migration it answers 500 and logs 23502.
--
-- server.js's inline TODO about this column can come out with it.
-- =============================================================================
