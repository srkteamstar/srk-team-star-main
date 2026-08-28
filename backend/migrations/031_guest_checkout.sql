-- True guest checkout: contact details are frozen on the order and no account
-- is created. A random browser-held token grants access to that one guest order;
-- only its SHA-256 hash is stored.
alter table public.orders alter column user_id drop not null;
alter table public.orders add column if not exists guest_access_token_hash text;

create unique index if not exists orders_guest_access_token_hash_unique
    on public.orders (guest_access_token_hash)
    where guest_access_token_hash is not null;

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
    if p_user_id is null and nullif(p_order->>'guest_access_token_hash', '') is null then
        raise exception 'an account id or guest access token is required';
    end if;
    if p_user_id is not null and nullif(p_order->>'guest_access_token_hash', '') is not null then
        raise exception 'an order cannot have both account and guest ownership';
    end if;
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'at least one order item is required';
    end if;

    insert into public.orders (
        user_id, guest_access_token_hash,
        amount, shipping_amount, tax_amount, net_amount, status,
        invoice_issued_at, currency, tax_rate, tax_type, place_of_supply,
        buyer_name, buyer_company, buyer_email, buyer_phone,
        seller_legal_name, seller_trade_name, seller_gstin, seller_address,
        seller_email, seller_phone, seller_state
    ) values (
        p_user_id, nullif(p_order->>'guest_access_token_hash', ''),
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
    'Server-only atomic checkout write for either an account owner or a token-protected guest.';

notify pgrst, 'reload schema';
