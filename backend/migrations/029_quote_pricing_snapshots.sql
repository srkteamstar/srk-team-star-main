-- =============================================================================
-- 029_quote_pricing_snapshots.sql — authoritative, atomic quote-request records
-- =============================================================================
-- Run after 028. Idempotent and DDL-only: existing requests remain readable,
-- while new requests carry the exact server calculation used at submission.

alter table public.quote_requests
    add column if not exists currency text,
    add column if not exists commercial_basis text,
    add column if not exists pricing_complete boolean,
    add column if not exists subtotal numeric(12,2),
    add column if not exists discount_amount numeric(12,2),
    add column if not exists tax_amount numeric(12,2),
    add column if not exists total numeric(12,2),
    add column if not exists calculation_version text,
    add column if not exists calculated_at timestamptz;

alter table public.quote_request_items
    add column if not exists unit_price numeric(12,2),
    add column if not exists discount_amount numeric(12,2),
    add column if not exists taxable_value numeric(12,2),
    add column if not exists gst_rate numeric(7,6),
    add column if not exists gst_amount numeric(12,2),
    add column if not exists line_total numeric(12,2),
    add column if not exists pricing_status text;

alter table public.quote_requests
    drop constraint if exists quote_requests_currency_check,
    add constraint quote_requests_currency_check
        check (currency is null or currency = 'INR'),
    drop constraint if exists quote_requests_commercial_basis_check,
    add constraint quote_requests_commercial_basis_check
        check (commercial_basis is null or commercial_basis = 'EX-WORKS'),
    drop constraint if exists quote_requests_money_nonnegative_check,
    add constraint quote_requests_money_nonnegative_check
        check (
            (subtotal is null or subtotal >= 0) and
            (discount_amount is null or discount_amount >= 0) and
            (tax_amount is null or tax_amount >= 0) and
            (total is null or total >= 0)
        );

alter table public.quote_request_items
    drop constraint if exists quote_request_items_pricing_status_check,
    add constraint quote_request_items_pricing_status_check
        check (pricing_status is null or pricing_status in ('priced', 'on_request')),
    drop constraint if exists quote_request_items_money_nonnegative_check,
    add constraint quote_request_items_money_nonnegative_check
        check (
            (unit_price is null or unit_price >= 0) and
            (discount_amount is null or discount_amount >= 0) and
            (taxable_value is null or taxable_value >= 0) and
            (gst_rate is null or gst_rate between 0 and 1) and
            (gst_amount is null or gst_amount >= 0) and
            (line_total is null or line_total >= 0)
        );

-- One database transaction for the header and every line. The function accepts
-- only the server role; public callers still reach it solely through Express.
create or replace function public.create_quote_request(
    p_request jsonb,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request public.quote_requests%rowtype;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'a quote request requires at least one item';
    end if;

    insert into public.quote_requests (
        business_name, contact_name, email, phone, business_address, notes,
        status, currency, commercial_basis, pricing_complete, subtotal,
        discount_amount, tax_amount, total, calculation_version, calculated_at
    ) values (
        p_request->>'business_name',
        p_request->>'contact_name',
        p_request->>'email',
        nullif(p_request->>'phone', ''),
        p_request->>'business_address',
        nullif(p_request->>'notes', ''),
        coalesce(nullif(p_request->>'status', ''), 'Open'),
        p_request->>'currency',
        p_request->>'commercial_basis',
        (p_request->>'pricing_complete')::boolean,
        (p_request->>'subtotal')::numeric,
        (p_request->>'discount_amount')::numeric,
        (p_request->>'tax_amount')::numeric,
        nullif(p_request->>'total', '')::numeric,
        p_request->>'calculation_version',
        (p_request->>'calculated_at')::timestamptz
    )
    returning * into v_request;

    insert into public.quote_request_items (
        quote_request_id, position, category_id, category_name, product_id,
        product_name, product_price, quantity, unit_price, discount_amount,
        taxable_value, gst_rate, gst_amount, line_total, pricing_status
    )
    select
        v_request.id,
        item.position,
        item.category_id,
        item.category_name,
        item.product_id,
        item.product_name,
        item.product_price,
        item.quantity,
        item.unit_price,
        item.discount_amount,
        item.taxable_value,
        item.gst_rate,
        item.gst_amount,
        item.line_total,
        item.pricing_status
    from jsonb_to_recordset(p_items) as item(
        position integer,
        category_id bigint,
        category_name text,
        product_id bigint,
        product_name text,
        product_price numeric,
        quantity integer,
        unit_price numeric,
        discount_amount numeric,
        taxable_value numeric,
        gst_rate numeric,
        gst_amount numeric,
        line_total numeric,
        pricing_status text
    );

    return jsonb_build_object('id', v_request.id, 'created_at', v_request.created_at);
end;
$$;

revoke all on function public.create_quote_request(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_quote_request(jsonb, jsonb) to service_role;

-- The request body and commercial snapshot are historical facts. Staff may
-- advance status (which also advances updated_at), but cannot rewrite what the
-- customer submitted or the server calculated after the reference was issued.
create or replace function public.protect_quote_request_snapshot()
returns trigger
language plpgsql
as $$
begin
    if row(
        new.business_name, new.contact_name, new.email, new.phone,
        new.business_address, new.notes, new.created_at, new.currency,
        new.commercial_basis, new.pricing_complete, new.subtotal,
        new.discount_amount, new.tax_amount, new.total,
        new.calculation_version, new.calculated_at
    ) is distinct from row(
        old.business_name, old.contact_name, old.email, old.phone,
        old.business_address, old.notes, old.created_at, old.currency,
        old.commercial_basis, old.pricing_complete, old.subtotal,
        old.discount_amount, old.tax_amount, old.total,
        old.calculation_version, old.calculated_at
    ) then
        raise exception 'quote request snapshots are immutable';
    end if;
    return new;
end;
$$;

drop trigger if exists quote_requests_protect_snapshot on public.quote_requests;
create trigger quote_requests_protect_snapshot
    before update on public.quote_requests
    for each row execute function public.protect_quote_request_snapshot();

create or replace function public.reject_quote_request_item_update()
returns trigger
language plpgsql
as $$
begin
    raise exception 'quote request item snapshots are immutable';
end;
$$;

drop trigger if exists quote_request_items_reject_update on public.quote_request_items;
create trigger quote_request_items_reject_update
    before update on public.quote_request_items
    for each row execute function public.reject_quote_request_item_update();

notify pgrst, 'reload schema';
