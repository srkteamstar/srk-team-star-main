-- =============================================================================
-- 023_remove_credentials.sql — historical credential removal (superseded)
-- =============================================================================
--
-- Historical migration only. The current authentication policy is restored by
-- 024_restore_authentication.sql, which MUST be applied after this file. Do not
-- deploy the current application with 023 as the last applied migration.
--
-- WHAT THIS DOES
-- --------------
-- Reverses the schema half of 015 (the administrator's TOTP second factor)
-- and of 022 (the customer password hash). After it there is no credential
-- column anywhere in this database.
--
--   user_profiles.password_hash            <- added by 022
--   user_profiles.admin_totp_secret        <- added by 015
--   user_profiles.admin_totp_enrolled_at   <- added by 015
--
-- WHAT THIS COSTS — READ BEFORE RUNNING
-- -------------------------------------
-- Both doors now take an identifier and nothing else, so this is the state of
-- the system it leaves behind:
--
--   * Knowing a customer's email address or phone number is the same as
--     owning their account: their name, phone, postal address and complete
--     order history.
--   * Knowing an ADMINISTRATOR's email address or phone number is the same as
--     owning the dashboard: every customer's name, phone and postal address,
--     every enquiry, every quote, every order, and delete rights on every
--     product, category and project.
--
-- 015 was written specifically to close the second one, and its own header
-- spells out why a business's administrator address is not a secret: a company
-- publishes it on its own contact page. That reasoning has not stopped being
-- true; it has been overruled. This file exists so the overruling is explicit
-- and dated rather than a column quietly left unread.
--
-- WHY DROP THE COLUMNS RATHER THAN LEAVE THEM
-- -------------------------------------------
-- A `password_hash` that is written but never verified is worse than no
-- column at all: the next person to read the schema concludes there is a
-- credential check somewhere and builds on a guarantee that does not exist.
-- The same argument this repo already made for never adding an empty
-- `password_hash` "for later" applies to leaving a populated one behind.
--
-- THIS IS NOT REVERSIBLE. Dropping these destroys every enrolled
-- authenticator secret and every stored password hash. Restoring the second
-- factor later means re-running 015 and re-enrolling every administrator from
-- scratch. TAKE A BACKUP FIRST — this is a destructive migration, in the same
-- category as 020, not a routine additive one.
--
-- It is written and deliberately NOT run for you.

begin;

-- 1 ---------------------------------------------------------------- customer
alter table public.user_profiles
    drop column if exists password_hash;

-- 2 ------------------------------------------------------------------- admin
alter table public.user_profiles
    drop column if exists admin_totp_secret;

alter table public.user_profiles
    drop column if exists admin_totp_enrolled_at;

commit;

-- 3 -------------------------------------------------------------- verify it
-- Expect zero rows.
--
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'user_profiles'
--      and column_name in ('password_hash', 'admin_totp_secret',
--                          'admin_totp_enrolled_at');
