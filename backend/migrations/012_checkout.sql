-- =============================================================================
-- 012_checkout.sql — everything POST /api/checkout needs that the tables do
-- not already provide
-- =============================================================================
--
-- Run after 011. Idempotent — safe to re-run.
--
-- The orders / order_items / order_shipping_address / payments tables already
-- existed and were readable (migration 010 granted select, and update on
-- orders, for the admin dashboard). Nothing has ever *written* them: the
-- storefront's "Proceed to Checkout" was a disabled button. This is the
-- schema half of making it real.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. orders.order_number needs to generate itself
--
--    It is NOT NULL with no default, so every insert had to invent one. The
--    obvious "max(order_number) + 1" is a race: two customers checking out in
--    the same instant both read the same max and one insert loses. A sequence
--    is the database doing it correctly and is the whole reason sequences
--    exist.
--
--    Started above whatever is already there, so re-running this on a live
--    table cannot hand out a number twice. setval's third argument false
--    means "the next nextval returns exactly this".
-- -----------------------------------------------------------------------------
create sequence if not exists public.orders_order_number_seq as bigint;

do $$
declare
    next_number bigint;
begin
    select coalesce(max(order_number), 1000) + 1 into next_number from public.orders;

    -- Only ever moved forward. If the sequence is already ahead (a re-run
    -- after orders have been placed), leave it alone.
    if next_number > (select last_value from public.orders_order_number_seq) then
        perform setval('public.orders_order_number_seq', next_number, false);
    end if;
end $$;

alter table public.orders
    alter column order_number set default nextval('public.orders_order_number_seq');

alter sequence public.orders_order_number_seq owned by public.orders.order_number;

comment on column public.orders.order_number is
    'Human-facing order number, from orders_order_number_seq. Never assigned by the client — see POST /api/checkout.';


-- -----------------------------------------------------------------------------
-- 2. order_shipping_address.zip_code: numeric -> text
--
--    The third table to carry this bug, after enquiries.enquirer_phone_number
--    and the two columns migration 011 fixed. A PIN is a label, not a
--    quantity: numeric drops leading zeros and would accept 360002.5.
--
--    This one matters more than the others, because it is the address a
--    parcel is actually sent to.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'order_shipping_address'
          and column_name = 'zip_code' and data_type <> 'text'
    ) then
        alter table public.order_shipping_address
            alter column zip_code type text using zip_code::text;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2b. orders.shipping_amount
--
--     orders carried amount / tax_amount / net_amount and nowhere to record
--     the delivery charge, so a total could not be taken apart again: given
--     only those three you cannot say how much of `amount` was freight.
--     Storing it makes the row self-describing, and an invoice reprintable
--     years later without re-deriving it from whatever the shipping rule
--     happens to be that day.
--
--     The four columns now mean exactly:
--        amount           goods, before tax and before delivery
--        shipping_amount  delivery, before tax
--        tax_amount       GST on (amount + shipping_amount)
--        net_amount       amount + shipping_amount + tax_amount, what is paid
-- -----------------------------------------------------------------------------
alter table public.orders add column if not exists shipping_amount double precision not null default 0;

comment on column public.orders.shipping_amount is
    'Delivery charge before tax. amount + shipping_amount + tax_amount = net_amount.';


-- -----------------------------------------------------------------------------
-- 3. Defaults for the timestamps the checkout route does not send.
-- -----------------------------------------------------------------------------
alter table public.orders alter column created_at set default now();
alter table public.orders alter column updated_at set default now();
alter table public.order_items alter column created_at set default now();
alter table public.order_shipping_address alter column created_at set default now();
alter table public.payments alter column created_at set default now();


-- -----------------------------------------------------------------------------
-- 4. One shipping address per order.
--
--    order_shipping_address is the frozen snapshot of where *this* order went,
--    which is why it is a separate table from shipping_addresses and why
--    editing your saved address must never rewrite it. Exactly one per order —
--    without this index a retried insert silently doubles it and there is no
--    rule saying which row a parcel follows.
-- -----------------------------------------------------------------------------
create unique index if not exists order_shipping_address_one_per_order_key
    on public.order_shipping_address (order_id);


-- -----------------------------------------------------------------------------
-- 5. Grants. 010 gave the service role read on all of these plus update on
--    orders; checkout needs to insert.
--
--    Still service_role only. The browser never talks to PostgREST for any of
--    this — it posts product ids and quantities to POST /api/checkout and the
--    server prices them. Nothing here is reachable with the anon key, which
--    is the point: a price the client can name is a price the client can
--    change.
--
--    No delete anywhere. A placed order is a record; cancelling one is a
--    status change (migration 010's orders_status_check already allows
--    'Cancelled'), not a deletion.
-- -----------------------------------------------------------------------------
grant insert on public.orders to service_role;
grant insert on public.order_items to service_role;
grant insert on public.order_shipping_address to service_role;
grant insert, update on public.payments to service_role;

do $$
declare
    seq text;
begin
    foreach seq in array array[
        'orders_id_seq', 'order_items_id_seq',
        'order_shipping_address_id_seq', 'payments_id_seq',
        'orders_order_number_seq'
    ]
    loop
        if exists (
            select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'S' and n.nspname = 'public' and c.relname = seq
        ) then
            execute format('grant usage, select on sequence public.%I to service_role', seq);
        end if;
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 6. RLS stays on and closed for the order tables, same posture as
--    user_profiles and quote_requests. These rows carry what somebody bought,
--    what they paid and where it went.
-- -----------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_shipping_address enable row level security;
alter table public.payments enable row level security;


-- -----------------------------------------------------------------------------
-- 7. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- select column_default from information_schema.columns
--  where table_name='orders' and column_name='order_number';
-- Expected: nextval('orders_order_number_seq'::regclass)
--
-- select data_type from information_schema.columns
--  where table_name='order_shipping_address' and column_name='zip_code';
-- Expected: text
--
-- select table_name, privilege_type from information_schema.role_table_grants
--  where grantee='service_role'
--    and table_name in ('orders','order_items','order_shipping_address','payments')
--  order by table_name, privilege_type;
-- Expected: INSERT on all four, SELECT on all four, UPDATE on orders and payments.
-- =============================================================================
