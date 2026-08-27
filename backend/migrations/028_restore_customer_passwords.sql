-- =============================================================================
-- 028_restore_customer_passwords.sql — restore the storefront credential
-- =============================================================================
--
-- Run after 027. Idempotent and additive: safe whether historical migration
-- 023 was applied or whether migration 022's column is still present.
--
-- The application now requires this value at registration and verifies it
-- before opening a customer session. It remains nullable because profiles
-- created during the identifier-only period have no trustworthy password to
-- backfill. Those accounts are deliberately refused until their credential is
-- reset; inventing or deriving one in a data migration would not prove who is
-- asking for the account.
-- =============================================================================

alter table public.user_profiles
    add column if not exists password_hash text;

comment on column public.user_profiles.password_hash is
    'Server-only scrypt$salt$hash customer credential. Never returned by publicProfile().';

grant select, insert, update on public.user_profiles to service_role;

notify pgrst, 'reload schema';

-- VERIFY
-- select column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'user_profiles'
--    and column_name = 'password_hash';
-- Expected: one nullable password_hash row.
