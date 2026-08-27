-- Historical customer-password experiment. Migration 023 removes this column,
-- and current customer access is intentionally identifier-only. Keep this file
-- in the numeric migration history; do not restore the column after 023.
alter table public.user_profiles
    add column if not exists password_hash text;

comment on column public.user_profiles.password_hash is
    'Server-only scrypt$salt$hash credential. Never returned by publicProfile().';
