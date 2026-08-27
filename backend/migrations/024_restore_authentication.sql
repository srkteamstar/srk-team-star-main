-- Restores the administrator TOTP columns removed by migration 023. Customer
-- access remains identifier-only by product decision. Run after 023.
begin;

alter table public.user_profiles
    add column if not exists admin_totp_secret text;

alter table public.user_profiles
    add column if not exists admin_totp_enrolled_at timestamptz;

comment on column public.user_profiles.admin_totp_secret is
    'Server-only Base32 TOTP secret. Null on an admin account means sign-in is refused until CLI enrolment.';
comment on column public.user_profiles.admin_totp_enrolled_at is
    'Time the current administrator authenticator secret was enrolled.';

revoke select (admin_totp_secret, admin_totp_enrolled_at)
    on public.user_profiles from anon, authenticated;

commit;
notify pgrst, 'reload schema';

-- VERIFY: expect both rows.
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='user_profiles'
-- and column_name in ('admin_totp_secret','admin_totp_enrolled_at');
