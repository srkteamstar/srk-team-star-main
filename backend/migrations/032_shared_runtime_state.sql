-- Shared state for serverless sessions and rate limits. Only the service role
-- may read or write these records.
create table if not exists public.storefront_sessions (
    sid text primary key,
    data jsonb not null,
    expires_at timestamptz not null,
    updated_at timestamptz not null default now()
);
create index if not exists storefront_sessions_expires_at_idx
    on public.storefront_sessions (expires_at);
alter table public.storefront_sessions enable row level security;
revoke all on public.storefront_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.storefront_sessions to service_role;

create table if not exists public.storefront_rate_limits (
    key text primary key,
    hits bigint not null,
    reset_at timestamptz not null
);
create index if not exists storefront_rate_limits_reset_at_idx
    on public.storefront_rate_limits (reset_at);
alter table public.storefront_rate_limits enable row level security;
revoke all on public.storefront_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.storefront_rate_limits to service_role;

create or replace function public.consume_storefront_rate_limit(p_key text, p_window_ms integer)
returns table(total_hits bigint, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_key is null or length(p_key) > 500 or p_window_ms < 1000 then
        raise exception 'invalid rate-limit input';
    end if;

    return query
    insert into public.storefront_rate_limits as limits(key, hits, reset_at)
    values (p_key, 1, now() + make_interval(secs => p_window_ms::double precision / 1000))
    on conflict (key) do update set
        hits = case when limits.reset_at <= now() then 1 else limits.hits + 1 end,
        reset_at = case
            when limits.reset_at <= now() then now() + make_interval(secs => p_window_ms::double precision / 1000)
            else limits.reset_at
        end
    returning limits.hits, limits.reset_at;
end;
$$;

create or replace function public.decrement_storefront_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.storefront_rate_limits set hits = greatest(hits - 1, 0) where key = p_key;
$$;

revoke all on function public.consume_storefront_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.decrement_storefront_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_storefront_rate_limit(text, integer) to service_role;
grant execute on function public.decrement_storefront_rate_limit(text) to service_role;

notify pgrst, 'reload schema';
