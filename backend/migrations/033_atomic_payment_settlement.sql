-- Settle a verified capture and move its order in one transaction. Row locks
-- make customer cancellation and gateway settlement serialize safely.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
    check (status in ('Pending Payment', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Payment Review'));

create or replace function public.settle_captured_store_payment(
    p_order_id bigint,
    p_payment_id bigint,
    p_transaction_id text,
    p_payment_method text,
    p_verified_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment public.payments%rowtype;
    v_order public.orders%rowtype;
    v_already boolean := false;
begin
    select * into v_order from public.orders
     where id = p_order_id for update;
    if not found then raise exception 'order not found'; end if;

    select * into v_payment from public.payments
     where id = p_payment_id and order_id = p_order_id for update;
    if not found then raise exception 'payment not found for order'; end if;

    if v_payment.status = 'Paid' then
        if v_payment.transaction_id is distinct from p_transaction_id then
            raise exception 'order is already paid by a different transaction';
        end if;
        v_already := true;
    else
        update public.payments set
            transaction_id = p_transaction_id,
            status = 'Paid',
            payment_method = p_payment_method,
            verified_at = p_verified_at
        where id = v_payment.id
        returning * into v_payment;
    end if;

    if v_order.status = 'Pending Payment' then
        update public.orders set status = 'Processing'
         where id = v_order.id returning * into v_order;
    elsif v_order.status = 'Cancelled' then
        -- Money arrived after cancellation won the lock. Do not fulfil and do
        -- not hide the capture: put the order in an explicit operator queue.
        update public.orders set status = 'Payment Review'
         where id = v_order.id returning * into v_order;
    end if;

    return jsonb_build_object(
        'already', v_already,
        'payment', to_jsonb(v_payment),
        'order_status', v_order.status,
        'requires_review', v_order.status = 'Payment Review'
    );
end;
$$;

revoke all on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)
    from public, anon, authenticated;
grant execute on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)
    to service_role;

comment on function public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz) is
    'Server-only atomic settlement. Serializes with cancellation and routes a post-cancellation capture to Payment Review.';

notify pgrst, 'reload schema';
