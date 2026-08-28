-- Frozen commercial identity and tax context for customer purchase invoices.
-- Existing orders stay nullable deliberately: migrations in this repository do
-- not rewrite live financial data. The API identifies incomplete historical
-- records instead of filling them from mutable customer profiles.
alter table public.orders add column if not exists invoice_number text;
alter table public.orders add column if not exists invoice_issued_at timestamptz;
alter table public.orders add column if not exists currency varchar(3);
alter table public.orders add column if not exists tax_rate numeric(7,6);
alter table public.orders add column if not exists tax_type text;
alter table public.orders add column if not exists place_of_supply text;

alter table public.orders add column if not exists buyer_name text;
alter table public.orders add column if not exists buyer_company text;
alter table public.orders add column if not exists buyer_email text;
alter table public.orders add column if not exists buyer_phone text;

alter table public.orders add column if not exists seller_legal_name text;
alter table public.orders add column if not exists seller_trade_name text;
alter table public.orders add column if not exists seller_gstin text;
alter table public.orders add column if not exists seller_address text;
alter table public.orders add column if not exists seller_email text;
alter table public.orders add column if not exists seller_phone text;
alter table public.orders add column if not exists seller_state text;

create unique index if not exists orders_invoice_number_unique
    on public.orders (invoice_number) where invoice_number is not null;

do $$ begin
    alter table public.orders add constraint orders_tax_type_check
        check (tax_type is null or tax_type in ('CGST_SGST', 'IGST'));
exception when duplicate_object then null;
end $$;

create or replace function public.create_store_order(
    p_user_id bigint,
    p_order jsonb,
    p_items jsonb,
    p_shipping jsonb,
    p_payment jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_order public.orders%rowtype;
    v_payment public.payments%rowtype;
begin
    if p_user_id is null then raise exception 'user_id is required'; end if;
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'at least one order item is required';
    end if;

    insert into public.orders (
        user_id, amount, shipping_amount, tax_amount, net_amount, status,
        invoice_issued_at, currency, tax_rate, tax_type, place_of_supply,
        buyer_name, buyer_company, buyer_email, buyer_phone,
        seller_legal_name, seller_trade_name, seller_gstin, seller_address,
        seller_email, seller_phone, seller_state
    ) values (
        p_user_id,
        (p_order->>'amount')::numeric,
        (p_order->>'shipping_amount')::numeric,
        (p_order->>'tax_amount')::numeric,
        (p_order->>'net_amount')::numeric,
        p_order->>'status',
        now(), nullif(p_order->>'currency', ''),
        nullif(p_order->>'tax_rate', '')::numeric,
        nullif(p_order->>'tax_type', ''), nullif(p_order->>'place_of_supply', ''),
        nullif(p_order->>'buyer_name', ''), nullif(p_order->>'buyer_company', ''),
        nullif(p_order->>'buyer_email', ''), nullif(p_order->>'buyer_phone', ''),
        nullif(p_order->>'seller_legal_name', ''), nullif(p_order->>'seller_trade_name', ''),
        nullif(p_order->>'seller_gstin', ''), nullif(p_order->>'seller_address', ''),
        nullif(p_order->>'seller_email', ''), nullif(p_order->>'seller_phone', ''),
        nullif(p_order->>'seller_state', '')
    ) returning * into v_order;

    update public.orders
       set invoice_number = 'INV-' ||
           to_char(v_order.invoice_issued_at at time zone 'Asia/Kolkata', 'YYYYMMDD') || '-' ||
           lpad(v_order.order_number::text, 6, '0')
     where id = v_order.id
    returning * into v_order;

    insert into public.order_items (
        order_id, product_id, product_name, price, quantity, total_amount
    )
    select v_order.id, item.product_id, item.product_name, item.price,
           item.quantity, item.total_amount
      from jsonb_to_recordset(p_items) as item(
        product_id bigint, product_name text, price numeric,
        quantity integer, total_amount numeric
    );

    insert into public.order_shipping_address (
        order_id, full_address, city, state, country, zip_code
    ) values (
        v_order.id, p_shipping->>'full_address', p_shipping->>'city',
        p_shipping->>'state', p_shipping->>'country', p_shipping->>'zip_code'
    );

    insert into public.payments (
        order_id, gateway, payment_method, amount, amount_paise, currency, status
    ) values (
        v_order.id, p_payment->>'gateway', nullif(p_payment->>'payment_method', ''),
        (p_payment->>'amount')::numeric, (p_payment->>'amount_paise')::bigint,
        p_payment->>'currency', p_payment->>'status'
    ) returning * into v_payment;

    return jsonb_build_object('order', to_jsonb(v_order), 'payment', to_jsonb(v_payment));
end;
$$;

revoke all on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) to service_role;

comment on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) is
    'Server-only atomic checkout write with frozen invoice, buyer, seller and tax snapshots.';

notify pgrst, 'reload schema';
