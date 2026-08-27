-- =============================================================================
-- 020_order_money_numeric.sql — money stops being a float
-- =============================================================================
--
-- Run after 019. Idempotent — safe to re-run; the conversion is skipped for any
-- column already numeric.
--
-- THIS TOUCHES EVERY PLACED ORDER. Read the whole file before running it, and
-- take a backup first (Supabase dashboard -> Database -> Backups). It is a
-- type change on live financial records, which is a different category of
-- migration from every other file in this directory.
--
-- WHAT IS WRONG TODAY
-- -------------------
-- `orders.amount`, `shipping_amount`, `tax_amount` and `net_amount` are
-- `double precision`. That is binary floating point, and it cannot represent
-- most decimal fractions exactly — 0.1 is not 0.1, it is the nearest double to
-- it. Migration 014 flagged this and deliberately did not fix it, because the
-- gateway comparison had a better answer available: `payments.amount_paise`,
-- an integer, which is what markOrderPaid() checks against and why a payment
-- can never be off by a rounding error.
--
-- So this is NOT a security fix and never was. `amount_paise` is still what
-- money is verified against, and this file does not touch it. What these four
-- columns are is the INVOICE: the numbers a customer is shown, that a printed
-- order has to add up on, and that a monthly total is summed from.
--
-- Two ways a double bites there, and neither announces itself:
--
--   Display. 1234.55 stored as a double and read back can render as
--   1234.5500000000001. Every read path currently rounds on the way out, so
--   this is invisible until one does not.
--
--   Sums. Adding a few hundred doubles accumulates error. A month's revenue
--   figure computed in Postgres and the same figure computed by adding the
--   invoices by hand can differ by a rupee or two, and there is no way to say
--   which is right — because with doubles, neither is.
--
-- `numeric(12,2)` is exact decimal. Two places, and up to 10 digits before
-- them: ten crore on one order, which this catalogue will not reach.
--
-- WHY THE CONVERSION IS SAFE
-- --------------------------
-- Every value in these columns was written by round2() in server.js:
--
--     Math.round((value + Number.EPSILON) * 100) / 100
--
-- so each one is already a number with at most two decimal places — it is
-- merely being STORED in a type that cannot hold that promise. Casting to
-- numeric(12,2) rounds each to two places, which for these values is the
-- identity operation. Section 1 proves that before changing anything, and
-- refuses the whole migration if it is not true.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- `order_items.price` and `order_items.total_amount` are left alone, along
-- with `payments.amount`. They deserve the same treatment and each is another
-- table's worth of risk; this file is deliberately the four columns that make
-- up the invoice identity
--
--     amount + shipping_amount + tax_amount = net_amount
--
-- so that identity becomes exactly true rather than true to within a float.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Refuse if any stored value would actually change.
--
--    The whole safety argument above is "every value already has at most two
--    decimal places". That is an argument about code that ran in the past, and
--    this checks it against the rows that are actually there — because if it
--    is wrong, this migration silently rewrites financial records.
--
--    A row that fails this is not a reason to force the cast. It means
--    something wrote one of these columns without going through round2(), and
--    that is worth finding before the evidence is rounded away.
-- -----------------------------------------------------------------------------
do $$
declare
    offenders bigint;
begin
    select count(*) into offenders
      from public.orders
     where (amount          is not null and amount          <> round(amount::numeric, 2))
        or (shipping_amount is not null and shipping_amount <> round(shipping_amount::numeric, 2))
        or (tax_amount      is not null and tax_amount      <> round(tax_amount::numeric, 2))
        or (net_amount      is not null and net_amount      <> round(net_amount::numeric, 2));

    if offenders > 0 then
        raise exception
            E'REFUSING TO CONVERT: % order row(s) hold a money value with more than 2 decimal places.\n'
            '  Converting would round real financial records. Find them first:\n'
            '    select id, amount, shipping_amount, tax_amount, net_amount from public.orders\n'
            '     where amount <> round(amount::numeric, 2)\n'
            '        or shipping_amount <> round(shipping_amount::numeric, 2)\n'
            '        or tax_amount <> round(tax_amount::numeric, 2)\n'
            '        or net_amount <> round(net_amount::numeric, 2);',
            offenders;
    end if;

    raise notice 'Pre-flight OK: every order money value already has at most 2 decimal places.';
end $$;


-- -----------------------------------------------------------------------------
-- 2. Convert.
--
--    One ALTER with four clauses rather than four ALTERs: the table is
--    rewritten once and locked once. `using` is explicit rather than left to
--    the implicit cast so the rounding rule is written down where it happens.
--
--    Guarded per column, so a re-run — or a database where someone converted
--    one of these by hand — is a no-op rather than an error.
-- -----------------------------------------------------------------------------
do $$
declare
    to_convert text[] := array[]::text[];
    col text;
begin
    foreach col in array array['amount', 'shipping_amount', 'tax_amount', 'net_amount'] loop
        if exists (
            select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders'
               and column_name = col and data_type <> 'numeric'
        ) then
            to_convert := to_convert || col;
        end if;
    end loop;

    if array_length(to_convert, 1) is null then
        raise notice 'Nothing to convert: all four columns are already numeric.';
        return;
    end if;

    foreach col in array to_convert loop
        execute format(
            'alter table public.orders alter column %I type numeric(12,2) using round(%I::numeric, 2)',
            col, col
        );
        raise notice 'Converted public.orders.% to numeric(12,2).', col;
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 3. The identity, now that it can be enforced.
--
--    amount + shipping_amount + tax_amount = net_amount was always the
--    intent — CLAUDE.md states it as the reason `shipping_amount` was added —
--    and it could not be a constraint while these were doubles, because
--    exact equality on floating point is not a thing to build a CHECK on.
--
--    NOT VALID, deliberately. It applies to every future write immediately and
--    does NOT scan the existing table. Any historical row that fails it does so
--    because it was written as a float, which is the very thing being fixed —
--    blocking this migration on old rounding noise would be the tail wagging
--    the dog. Validate it separately when you are ready to look at what falls
--    out:
--
--        alter table public.orders validate constraint orders_money_adds_up;
--
--    Nulls are allowed through: `is not distinct from` would fail an order with
--    no shipping recorded, and there are such rows from before 012.
-- -----------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_money_adds_up;

alter table public.orders
    add constraint orders_money_adds_up
    check (
        amount is null or shipping_amount is null or tax_amount is null or net_amount is null
        or round(amount + shipping_amount + tax_amount, 2) = round(net_amount, 2)
    ) not valid;


-- -----------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache.
--
--    Column types are part of what it caches. Without this it keeps serving
--    the old type for these columns, which is how a conversion looks like it
--    did not take.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The four columns are numeric(12,2).
-- select column_name, data_type, numeric_precision, numeric_scale
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'orders'
--    and column_name in ('amount', 'shipping_amount', 'tax_amount', 'net_amount')
--  order by column_name;
-- Expected: numeric, 12, 2 — four times.
--
-- -- 1b. THE ONE THING TO ACTUALLY EXERCISE AFTERWARDS.
-- --
-- --     PostgREST serialises `numeric` as a JSON number, the same as it does
-- --     `double precision`, so every reader of these four columns should be
-- --     unaffected — orders.js's formatAmount(o.netAmount), the admin drawer's
-- --     money rows, /api/orders/mine. That is the expectation, and it is worth
-- --     five seconds of proof rather than trust, because if it ever came back
-- --     as a STRING instead then every total on the dashboard would render as
-- --     text and every arithmetic comparison would silently coerce.
-- --
-- --     With the server running:
-- --
-- --       curl -s localhost:3000/api/orders -H 'Cookie: <an admin session>' | head -c 400
-- --
-- --     Look at net_amount. It must be 2360.00 and not "2360.00".
-- --
-- --     Nothing in this codebase compares these columns to money — the gateway
-- --     is checked against payments.amount_paise, an integer, which this file
-- --     does not touch — so even the bad case is a display bug rather than a
-- --     financial one.
--
-- -- 2. Nothing changed in value.
-- --    Run this BEFORE and AFTER; the two outputs must be identical.
-- select sum(amount), sum(shipping_amount), sum(tax_amount), sum(net_amount)
--   from public.orders;
--
-- -- 3. How many historical rows do not satisfy the identity?
-- --    Run this before deciding whether to VALIDATE the constraint. A handful
-- --    off by 0.01 is float noise from before this migration; a row off by
-- --    more than that is a real bug worth chasing.
-- select id, amount, shipping_amount, tax_amount, net_amount,
--        round(amount + shipping_amount + tax_amount, 2) - round(net_amount, 2) as drift
--   from public.orders
--  where amount is not null and shipping_amount is not null
--    and tax_amount is not null and net_amount is not null
--    and round(amount + shipping_amount + tax_amount, 2) <> round(net_amount, 2)
--  order by abs(round(amount + shipping_amount + tax_amount, 2) - round(net_amount, 2)) desc;
-- =============================================================================
