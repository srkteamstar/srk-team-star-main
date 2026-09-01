-- =============================================================================
-- 037_checkout_retry_integrity.sql — a retry key is no longer a bearer credential
-- =============================================================================
--
-- Run after 035. Idempotent — safe to re-run.
--
-- WHAT WAS WRONG
-- --------------
-- S04 (MEDIUM) — checkout.controller.js's idempotency lookup matched an order
-- by idempotency_key alone, with no check that the caller retrying was the
-- caller who created it. For a guest order it then rotated the access-token
-- hash and handed back a fresh token — so a leaked or guessed key disclosed a
-- guest order AND silently invalidated the real customer's recovery token.
--
-- F08 (MEDIUM) — the same lookup re-priced the request against the CURRENT
-- catalogue and returned those fresh totals next to the OLD, frozen order.
-- A retry whose body had changed since the original request (a quantity
-- edited, an item added) could report a total that matched neither the
-- order, the invoice, nor the amount already sent to the gateway.
--
-- WHAT REPLACES IT
-- -----------------
-- Two nullable columns on an order, both written once at creation and never
-- rewritten:
--
--   checkout_proof_hash   SHA-256 of a second random value the browser holds
--                         alongside its idempotency key (see
--                         checkout-module.js) — generated the same way, at
--                         the same time, but never sent or logged anywhere
--                         except this one route. checkout.controller.js now
--                         requires it to match before an existing GUEST
--                         order is returned or its access token rotated. An
--                         account-owned order needs no such proof — the
--                         signed-in session already is one.
--
--   request_fingerprint   a deterministic hash of the normalized request
--                         (items, quantities, contact/delivery details,
--                         payment choice) taken at creation time.
--                         checkout.controller.js recomputes it on every
--                         retry and refuses to reuse the order — 409,
--                         "start a new checkout" — if it no longer matches,
--                         rather than silently reporting a re-priced total
--                         against a frozen order.
--
-- Both are nullable so an order created before this migration ships (no
-- fingerprint, no proof) keeps working exactly as it did — F08's fix treats
-- a null request_fingerprint as "nothing to compare", never as a mismatch,
-- and S04's guest-proof check only applies going forward for the same
-- reason spelled out in checkout.controller.js.
-- =============================================================================

alter table public.orders
    add column if not exists checkout_proof_hash text,
    add column if not exists request_fingerprint text;

comment on column public.orders.checkout_proof_hash is
    'SHA-256 of a random value the browser generated alongside its idempotency key, for a GUEST order only. Required before an idempotent retry may read this order back or rotate guest_access_token_hash. Null for an account-owned order (the session is the proof) and for any order created before this column existed.';

comment on column public.orders.request_fingerprint is
    'Deterministic hash of the normalized checkout request (items, contact/delivery, payment choice) taken when this order was written. An idempotent retry whose fingerprint no longer matches is refused with 409 rather than silently returning freshly re-priced totals against this frozen order. Null for an order created before this column existed, which is treated as "nothing to compare" rather than a mismatch.';

-- create_store_order (025, redefined by 030/031/035) needs the two new
-- fields threaded through to the INSERT — CREATE OR REPLACE restates the
-- whole body, so this is 035's body plus checkout_proof_hash and
-- request_fingerprint, not a diff.
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
        user_id, guest_access_token_hash, idempotency_key,
        checkout_proof_hash, request_fingerprint,
        amount, shipping_amount, tax_amount, net_amount, status,
        invoice_issued_at, currency, tax_rate, tax_type, place_of_supply,
        buyer_name, buyer_company, buyer_email, buyer_phone,
        seller_legal_name, seller_trade_name, seller_gstin, seller_address,
        seller_email, seller_phone, seller_state
    ) values (
        p_user_id, nullif(p_order->>'guest_access_token_hash', ''),
        nullif(p_order->>'idempotency_key', ''),
        nullif(p_order->>'checkout_proof_hash', ''),
        nullif(p_order->>'request_fingerprint', ''),
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
    'Server-only atomic checkout write for either an account owner or a token-protected guest. Carries the browser''s idempotency key, guest checkout proof and request fingerprint so a lost-response retry lands on the same order, cannot be pulled by a third party, and cannot report a re-priced total against a changed request.';

notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- select column_name, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'orders'
--    and column_name in ('checkout_proof_hash', 'request_fingerprint');
-- Expected: both present, both nullable.
-- =============================================================================
