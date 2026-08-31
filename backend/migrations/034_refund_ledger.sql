-- A running refund total, so cumulative partial refunds settle correctly.
--
-- Before this, refund.processed compared EACH event's amount against the
-- full payment total in JavaScript. Two ₹400 and ₹780 refunds against a
-- ₹1,180 payment — together the whole amount — each failed that comparison
-- on its own and left the row at 'Partially Refunded' forever. The fix needs
-- a place to accumulate what has actually come back, which is this column,
-- and a single atomic writer for it, which is the function below.
alter table public.payments
    add column if not exists refunded_amount_paise bigint not null default 0;

create or replace function public.apply_store_refund(
    p_payment_id bigint,
    p_refund_amount_paise bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment public.payments%rowtype;
    v_total bigint;
    v_status text;
begin
    select * into v_payment from public.payments
     where id = p_payment_id for update;
    if not found then
        return jsonb_build_object('applied', false, 'reason', 'payment not found');
    end if;

    -- A refund only ever means something against money that was actually
    -- captured. A row still Created, Failed, or already fully Refunded needs
    -- no further change here — applying a delta to it would either invent a
    -- refund against money that never moved, or double-count one already
    -- recorded in full.
    if v_payment.status not in ('Paid', 'Partially Refunded') then
        return jsonb_build_object('applied', false, 'reason', v_payment.status, 'payment', to_jsonb(v_payment));
    end if;

    v_total := v_payment.refunded_amount_paise + coalesce(p_refund_amount_paise, 0);
    v_status := case when v_total >= v_payment.amount_paise then 'Refunded' else 'Partially Refunded' end;

    update public.payments set
        refunded_amount_paise = v_total,
        status = v_status
    where id = v_payment.id
    returning * into v_payment;

    return jsonb_build_object('applied', true, 'payment', to_jsonb(v_payment));
end;
$$;

revoke all on function public.apply_store_refund(bigint,bigint)
    from public, anon, authenticated;
grant execute on function public.apply_store_refund(bigint,bigint)
    to service_role;

comment on function public.apply_store_refund(bigint,bigint) is
    'Server-only atomic refund ledger. Accumulates refunded_amount_paise per event and derives Refunded/Partially Refunded from the cumulative total.';

notify pgrst, 'reload schema';
