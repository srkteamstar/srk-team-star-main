-- Creates the order header, item rows, frozen shipping address and initial
-- payment row in one PostgreSQL transaction. Postgres functions are atomic:
-- any exception rolls the entire call back, leaving no partial order.
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
        user_id, amount, shipping_amount, tax_amount, net_amount, status
    ) values (
        p_user_id,
        (p_order->>'amount')::numeric,
        (p_order->>'shipping_amount')::numeric,
        (p_order->>'tax_amount')::numeric,
        (p_order->>'net_amount')::numeric,
        p_order->>'status'
    ) returning * into v_order;

    insert into public.order_items (
        order_id, product_id, product_name, price, quantity, total_amount
    )
    select
        v_order.id, item.product_id, item.product_name, item.price,
        item.quantity, item.total_amount
    from jsonb_to_recordset(p_items) as item(
        product_id bigint,
        product_name text,
        price numeric,
        quantity integer,
        total_amount numeric
    );

    insert into public.order_shipping_address (
        order_id, full_address, city, state, country, zip_code
    ) values (
        v_order.id,
        p_shipping->>'full_address',
        p_shipping->>'city',
        p_shipping->>'state',
        p_shipping->>'country',
        p_shipping->>'zip_code'
    );

    insert into public.payments (
        order_id, gateway, payment_method, amount, amount_paise, currency, status
    ) values (
        v_order.id,
        p_payment->>'gateway',
        nullif(p_payment->>'payment_method', ''),
        (p_payment->>'amount')::numeric,
        (p_payment->>'amount_paise')::bigint,
        p_payment->>'currency',
        p_payment->>'status'
    ) returning * into v_payment;

    return jsonb_build_object('order', to_jsonb(v_order), 'payment', to_jsonb(v_payment));
end;
$$;

revoke all on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) to service_role;

comment on function public.create_store_order(bigint,jsonb,jsonb,jsonb,jsonb) is
    'Server-only atomic checkout write: order, items, frozen shipping address and initial payment.';

notify pgrst, 'reload schema';
