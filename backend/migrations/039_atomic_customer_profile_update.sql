-- =============================================================================
-- 039_atomic_customer_profile_update.sql — one transaction for PATCH /api/auth/me
-- =============================================================================
--
-- Run after 011 (the tables and the one-address-per-user index this depends
-- on). Idempotent — safe to re-run.
--
-- Context: PATCH /api/auth/me used to write user_profiles and
-- shipping_addresses as two separate Supabase calls. Ordinary interleaving is
-- not the risk — Postgres row locks already keep two writers off the same
-- row — the risk is a FAILURE between the two calls: the profile half commits,
-- the address half throws (an oversized value the API check missed, a
-- transient connection drop), and the customer is left with a saved name and
-- a stale or absent address with nothing to say the edit was only half
-- applied. Same shape of bug 025 and 033 already closed for checkout and
-- payment settlement — the fix here is the same move: one PostgreSQL function,
-- one transaction, so an exception anywhere in it rolls back everything it
-- touched.
--
-- The controller still does its own validation and address-merge (reading the
-- existing row to fill in fields the request omitted) before calling this —
-- that part was never the atomicity problem and moving it into SQL would only
-- duplicate logic shared with GET /api/auth/me's read path. This function's
-- job is narrower: given the two already-prepared payloads, write them
-- together or not at all, behind a lock that also serializes two concurrent
-- edits by the same customer.
-- =============================================================================

create or replace function public.update_customer_profile_and_address(
    p_user_id bigint,
    p_profile jsonb,
    p_address jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_user_id is null then raise exception 'user_id is required'; end if;

    -- Locked first and unconditionally, even when only the address half is
    -- being written: this is what makes two concurrent PATCH /api/auth/me
    -- calls for the same customer serialize instead of interleave.
    perform 1 from public.user_profiles where id = p_user_id for update;
    if not found then raise exception 'profile not found'; end if;

    if p_profile is not null and p_profile <> '{}'::jsonb then
        update public.user_profiles set
            full_name = coalesce(p_profile->>'full_name', full_name),
            phone_number = coalesce(p_profile->>'phone_number', phone_number),
            phone_normalized = coalesce(p_profile->>'phone_normalized', phone_normalized),
            -- company is the one nullable field here — a customer clearing it
            -- is a real edit, not an absent one, so presence of the key (not
            -- truthiness of its value) decides whether it is touched.
            company = case when p_profile ? 'company' then p_profile->>'company' else company end,
            updated_at = coalesce((p_profile->>'updated_at')::timestamptz, now())
        where id = p_user_id;
    end if;

    if p_address is not null and p_address <> '{}'::jsonb then
        -- shipping_addresses_one_per_user_key (migration 011) is what makes
        -- this upsert safe: at most one row per user_id, so "does this
        -- customer already have an address" never has two possible answers.
        insert into public.shipping_addresses (
            user_id, full_address, city, state, country, zip_code, updated_at
        ) values (
            p_user_id,
            p_address->>'full_address',
            p_address->>'city',
            p_address->>'state',
            p_address->>'country',
            p_address->>'zip_code',
            now()
        )
        on conflict (user_id) do update set
            full_address = excluded.full_address,
            city = excluded.city,
            state = excluded.state,
            country = excluded.country,
            zip_code = excluded.zip_code,
            updated_at = excluded.updated_at;
    end if;
end;
$$;

revoke all on function public.update_customer_profile_and_address(bigint,jsonb,jsonb)
    from public, anon, authenticated;
grant execute on function public.update_customer_profile_and_address(bigint,jsonb,jsonb)
    to service_role;

comment on function public.update_customer_profile_and_address(bigint,jsonb,jsonb) is
    'Server-only atomic customer edit: profile fields and the one shipping address in one transaction, serialized by a row lock on the profile.';

notify pgrst, 'reload schema';

-- =============================================================================
-- VERIFY
-- =============================================================================
-- select proname, prosecdef from pg_proc
--  where proname = 'update_customer_profile_and_address';
-- Expected: one row, prosecdef = true (security definer).
--
-- select routine_name, privilege_type, grantee from information_schema.routine_privileges
--  where routine_name = 'update_customer_profile_and_address';
-- Expected: EXECUTE granted to service_role only.
-- =============================================================================
