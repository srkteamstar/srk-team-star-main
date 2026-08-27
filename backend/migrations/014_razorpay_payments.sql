-- =============================================================================
-- 014_razorpay_payments.sql — the schema a real payment gateway needs
-- =============================================================================
--
-- Run after 013. Idempotent — safe to re-run.
--
-- WHAT `payments` IS TODAY
-- -----------------------
-- One row per order, written once by POST /api/checkout as
-- { payment_method: 'Offline', amount, status: 'Pending' } and never touched
-- again. That is an honest ledger for a B2B flow where the sales team settles
-- by bank transfer, and it needs almost nothing: nobody can lie to it, because
-- nothing outside the office ever writes it.
--
-- A gateway inverts that. The row now describes something that happened on
-- somebody else's servers, and the only reports of it arrive over the public
-- internet — one from the customer's own browser, which is an attacker-
-- controlled channel, and one from Razorpay's webhook, which is not. The
-- table's job changes from "record what we agreed" to "hold a claim that can
-- be checked against the gateway and can only be believed once".
--
-- Every section below is one of those two words: *checked*, or *once*.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------
-- orders.amount / shipping_amount / tax_amount / net_amount are
-- `double precision`, which is the wrong type for money and always was.
-- Converting them to numeric(12,2) touches every placed order and deserves its
-- own migration with its own verification; it is not bundled in here where it
-- would be the riskiest thing in a file that otherwise only adds.
--
-- What blocks a gateway launch is narrower and is fixed here: the figure
-- compared against Razorpay must be an exact integer, so `payments` gets
-- `amount_paise bigint` and the comparison never touches a float at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The gateway columns
--
--    `gateway` is the provider; `payment_method` is the instrument. These are
--    different facts and the existing column only ever held the first one
--    because there was no provider. From here `payment_method` widens to carry
--    what Razorpay reports for a real payment — 'card', 'upi', 'netbanking',
--    'wallet', 'emi' — and keeps 'Offline' for a row the sales team settles.
--
--    `gateway` is nullable with NO default, on purpose. 'razorpay' would be
--    wrong for offline rows and 'offline' would be worse: a bug that forgets
--    to set the column would file a real card payment as an offline one and
--    quietly drop it out of every reconciliation query. A null is visible; a
--    plausible wrong default is not. Loud beats tidy where money is concerned.
--
--    `gateway_order_id` is the column that closes the cross-order replay
--    attack. A Razorpay signature proves Razorpay issued that payment. It says
--    nothing about which of OUR orders it belongs to — so a customer can pay
--    for a 1-rupee spare part, keep the three strings the callback hands them,
--    and post them back against a 5-lakh machine order. The signature verifies,
--    because it is genuine. What refuses it is comparing the callback's
--    razorpay_order_id against the one stored on THIS row when the order was
--    created. Without somewhere to store that, the check is not possible.
--
--    `currency` because "captured, correct amount" is not enough on its own:
--    the amount has to have been captured in the currency the order is priced
--    in. Default INR, which is the only one this catalogue quotes.
--
--    `verified_at` is set only when the server has confirmed the payment with
--    Razorpay over a server-to-server call — never when a browser said so.
--    A Paid row with a null verified_at is therefore a row that was believed
--    without being checked, which is a thing you want to be able to SELECT.
-- -----------------------------------------------------------------------------
alter table public.payments add column if not exists gateway          text;
alter table public.payments add column if not exists gateway_order_id text;
alter table public.payments add column if not exists currency         text not null default 'INR';
alter table public.payments add column if not exists verified_at      timestamptz;
alter table public.payments add column if not exists updated_at       timestamptz not null default now();

comment on column public.payments.gateway is
    'Payment provider: razorpay or offline. Null means nobody set it — treat as a defect, not as offline.';
comment on column public.payments.gateway_order_id is
    'Razorpay order id (order_xxx). Compared against the checkout callback so a valid signature for a DIFFERENT order cannot be replayed onto this one.';
comment on column public.payments.transaction_id is
    'Razorpay payment id (pay_xxx). The idempotency key — see payments_transaction_id_key.';
comment on column public.payments.payment_method is
    'Instrument: card / upi / netbanking / wallet / emi for a gateway payment, Offline for one the sales team settles.';
comment on column public.payments.currency is
    'ISO currency of amount_paise. Verified against the gateway alongside the amount — a correct number in the wrong currency is not a correct payment.';
comment on column public.payments.verified_at is
    'When the server independently confirmed this with Razorpay. Null on a Paid row means it was believed on a client report alone.';

-- Backfill the rows that predate this file. They are all offline by
-- definition: nothing else existed to write them.
--
-- FOLLOW-UP, and the one thing this file leaves undone: POST /api/checkout
-- does not send `gateway` yet, so every offline order placed between running
-- this and updating that route inserts a null and this backfill goes stale
-- behind it. One line in the payments insert — gateway: 'offline' — closes
-- it, and belongs with the payment module rather than here. VERIFY query 5
-- is what catches it if it is forgotten.
update public.payments set gateway = 'offline'
 where gateway is null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'payments_gateway_check') then
        alter table public.payments
            add constraint payments_gateway_check
            check (gateway is null or gateway in ('razorpay', 'offline'));
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. The amount, as an exact integer
--
--    Razorpay works in paise and compares exactly. `payments.amount` is
--    double precision, and a total out by 1e-13 is not a rounding annoyance
--    against a gateway — it is a mismatch that either blocks the payment or,
--    far worse, passes while leaving the books permanently disagreeing with
--    the settlement report.
--
--    bigint, so the verification is integer = integer with no tolerance
--    anywhere in it. A tolerance in a payment comparison is a hole with a
--    threshold: whatever slack you allow is exactly how much an attacker may
--    underpay.
--
--    `amount` stays as it is. Both columns describing one figure is redundancy
--    on purpose during the changeover — amount_paise is what the gateway is
--    checked against, amount is what every existing read already uses.
-- -----------------------------------------------------------------------------
alter table public.payments add column if not exists amount_paise bigint;

comment on column public.payments.amount_paise is
    'Exact integer paise. THE figure compared against Razorpay — never amount, which is a float. amount_paise = round(amount * 100).';

update public.payments
   set amount_paise = round(amount::numeric * 100)::bigint
 where amount_paise is null
   and amount is not null;


-- -----------------------------------------------------------------------------
-- 3. The status vocabulary
--
--    Free text is how a typo becomes an unpaid order that reads as paid, or a
--    paid one that never ships. Six values, and every one of them is a state
--    something in the system actually produces:
--
--      Created             a Razorpay order exists, the customer has not paid
--      Pending             an offline order awaiting settlement (today's only value)
--      Paid                captured, and verified against the gateway
--      Failed              payment.failed, or a verification that did not match
--      Refunded            refund.processed, in full
--      Partially Refunded  refund.processed, for less than the full amount
--
--    The two refund states are here despite nothing writing them yet, which is
--    the opposite of this repo's rule about not building unused doors — and
--    deliberately so. An unused GRANT is an open door; an unused *check value*
--    is the reverse, because the failure mode runs the other way. A constraint
--    that rejects a legitimate refund event does not fail in a code review, it
--    fails at 2am inside a webhook handler, and the operator's fastest way out
--    is to weaken the constraint under pressure. Razorpay emits both shapes.
--    The list allows both.
--
--    Guarded rather than forced: if a row already holds something outside the
--    list, this raises a notice and skips instead of aborting the file, so the
--    rest of the migration still applies. Silently rewriting somebody's
--    payment status to make a constraint fit is not on the table.
-- -----------------------------------------------------------------------------
do $$
declare
    bad_count  integer;
    bad_values text;
begin
    if exists (select 1 from pg_constraint where conname = 'payments_status_check') then
        return;
    end if;

    select count(*), string_agg(distinct coalesce(status, '(null)'), ', ')
      into bad_count, bad_values
      from public.payments
     where status is null
        or status not in ('Created', 'Pending', 'Paid', 'Failed', 'Refunded', 'Partially Refunded');

    if bad_count > 0 then
        raise notice
            'payments_status_check NOT added: % row(s) hold a status outside the allowed list (%). Correct those rows, then re-run this file.',
            bad_count, bad_values;
        return;
    end if;

    alter table public.payments
        add constraint payments_status_check
        check (status in ('Created', 'Pending', 'Paid', 'Failed', 'Refunded', 'Partially Refunded'));
end $$;


-- -----------------------------------------------------------------------------
-- 4. The two uniqueness rules — this is the whole idempotency guarantee
--
--    4a. One row per Razorpay payment id.
--
--    Razorpay redelivers a webhook on any non-2xx and sometimes on a slow one,
--    and the browser callback races the webhook by milliseconds. Both paths
--    call the same "mark this paid" function, and that function is only safe to
--    call repeatedly because THIS INDEX makes the second insert fail with
--    23505 — which the handler catches and treats as success, because a
--    duplicate means it already happened. Without the index there is no error
--    to catch and no signal that anything was double-counted.
--
--    Partial, `where transaction_id is not null`, for two reasons. Offline rows
--    have no payment id and there will be many of them; and while Postgres
--    treats nulls as distinct by default — so a plain unique index would in
--    fact permit them — relying on that default to hold across a version
--    upgrade or a NULLS NOT DISTINCT rewrite is a bet with no upside. The
--    partial predicate says what is meant.
--
--    4b. An order can be paid once.
--
--    The application-level guarantee is 4a. This is the storage-level one, and
--    it is here because an idempotency bug is not the only way to credit an
--    order twice — two genuinely different payment ids against one order does
--    it too, and 4a cannot see that. Multiple payment ROWS per order stay legal
--    (Created, then Failed, then Created, then Paid is the ordinary retry
--    path, and fetchOrderRows() already picks the latest by created_at); what
--    cannot happen is two of them reading 'Paid' at the same time.
--
--    Refunds fit without an exception: the refunded row moves to 'Refunded' or
--    'Partially Refunded' and leaves the predicate, so a re-payment can take
--    the slot.
--
--    Both are created against live data. If either fails, do not weaken it —
--    it has just told you that the duplicate it exists to prevent is already
--    in the table.
-- -----------------------------------------------------------------------------
create unique index if not exists payments_transaction_id_key
    on public.payments (transaction_id)
    where transaction_id is not null;

create unique index if not exists payments_one_paid_per_order_key
    on public.payments (order_id)
    where status = 'Paid';


-- -----------------------------------------------------------------------------
-- 5. Lookup paths
--
--    order_id: the admin Orders tab and GET /api/orders/mine both fetch
--    payments with `.in('order_id', ...)` on every load. Postgres does not
--    index a foreign key column for you, and this table was made in the
--    Supabase table editor, so there is nothing here today.
--
--    gateway_order_id: a webhook arrives knowing Razorpay's ids and nothing
--    else — resolving it to one of our orders is this lookup. NOT unique:
--    Razorpay permits several payment attempts against one order, so a failed
--    attempt and the successful retry legitimately share it.
-- -----------------------------------------------------------------------------
create index if not exists payments_order_id_idx
    on public.payments (order_id);

create index if not exists payments_gateway_order_id_idx
    on public.payments (gateway_order_id)
    where gateway_order_id is not null;


-- -----------------------------------------------------------------------------
-- 6. updated_at maintenance
--
--    New here, because a payments row was previously written once and never
--    revisited. Under a gateway it moves Created -> Paid, or Paid -> Refunded,
--    and "when did this last change" stops being derivable from created_at.
--
--    public.set_updated_at() already exists from 001_categories.sql; recreated
--    with `or replace` so this file also stands alone on a fresh database,
--    same as 009 does.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
    before update on public.payments
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 7. orders gains a pre-payment state
--
--    010's constraint allows Processing / Shipped / Delivered / Cancelled, and
--    an order that has not been paid for is none of those. Filing it as
--    'Processing' tells the team on the floor to begin fulfilment against money
--    that has not arrived, which is the single most expensive thing this
--    migration prevents.
--
--    Safe to drop and re-add unguarded: the new list is a strict superset of
--    the old one, so no existing row can violate it.
--
--    Note what does NOT change. server.js's ORDER_STATUSES — the list
--    PATCH /api/orders/:id/status validates against — deliberately keeps its
--    four values and does not gain this one. 'Pending Payment' is a state the
--    payment flow sets and clears; an administrator hand-picking it from a
--    dropdown would be asserting something about money from a screen that
--    cannot observe money. The database permits the value, the admin route
--    does not offer it, and that gap is the point.
-- -----------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
    add constraint orders_status_check
    check (status in ('Pending Payment', 'Processing', 'Shipped', 'Delivered', 'Cancelled'));

comment on column public.orders.status is
    'Fulfillment status. One of Pending Payment / Processing / Shipped / Delivered / Cancelled. Pending Payment is set by the payment flow only — the admin PATCH route does not offer it. Separate from payments.status, which tracks money.';


-- -----------------------------------------------------------------------------
-- 8. payment_events — every webhook, exactly as it arrived
--
--    A webhook handler that verifies a signature, updates an order and returns
--    200 has destroyed its own evidence. When a customer says they paid and
--    the order says otherwise, the question is always "what did Razorpay
--    actually send us, and what did we do with it" — and the answer has to
--    exist independently of whether the processing worked.
--
--    So the handler's first act is to insert here, with the raw payload and
--    whether the signature verified, BEFORE any interpretation of it. Then it
--    processes, then it stamps processed_at. Three consequences fall out:
--
--      * A crash mid-processing loses nothing. The event is on disk and can
--        be replayed from this table.
--      * `where processed_at is null` is a work queue and an alarm.
--      * `signature_verified = false` rows accumulate as a log of who is
--        posting forged events at the endpoint, which is worth knowing and is
--        invisible if you simply 401 and forget.
--
--    event_id is Razorpay's own x-razorpay-event-id header, and its unique
--    index is a SECOND idempotency key, independent of section 4a. 4a stops
--    the same payment being recorded twice; this stops the same delivery being
--    processed twice at all, including for event types that touch no payment
--    row. Two locks on different doors, because retried webhooks are ordinary
--    traffic rather than an exception.
--
--    order_id is a plain bigint with no foreign key, the same call
--    009_quote_requests.sql made for its item rows and for the same reason:
--    this is a historical record of something that arrived, and it must be
--    storable even when it names an order that does not exist — which is
--    precisely the case worth keeping, since an event referencing an unknown
--    order is either a forgery or a bug, and a FK would refuse to record
--    either one.
-- -----------------------------------------------------------------------------
create table if not exists public.payment_events (
    id                 bigint generated by default as identity primary key,
    event_id           text        not null,
    event_type         text        not null,
    gateway            text        not null default 'razorpay',
    gateway_order_id   text,
    gateway_payment_id text,
    order_id           bigint,
    payload            jsonb       not null,
    signature_verified boolean     not null default false,
    received_at        timestamptz not null default now(),
    processed_at       timestamptz,
    process_error      text
);

comment on table public.payment_events is
    'Append-only log of every gateway webhook, stored before it is interpreted. Replay source, audit trail, and second idempotency key. Never updated except processed_at/process_error, never deleted — see the grants in section 9.';
comment on column public.payment_events.event_id is
    'Razorpay x-razorpay-event-id. Unique — this is what makes a redelivered webhook a no-op.';
comment on column public.payment_events.signature_verified is
    'False rows are forged or misconfigured deliveries. Kept rather than discarded: they are the only visibility into someone probing the endpoint.';
comment on column public.payment_events.processed_at is
    'Null means received but not yet acted on. processed_at is null, older than a few minutes, is an alarm.';

create unique index if not exists payment_events_event_id_key
    on public.payment_events (event_id);

create index if not exists payment_events_unprocessed_idx
    on public.payment_events (received_at)
    where processed_at is null;

create index if not exists payment_events_order_idx
    on public.payment_events (order_id);

create index if not exists payment_events_gateway_payment_idx
    on public.payment_events (gateway_payment_id)
    where gateway_payment_id is not null;


-- -----------------------------------------------------------------------------
-- 9. Grants
--
--    The trap section 5 of 001_categories.sql documents, for the fourth time:
--    the service role's RLS bypass is not a table privilege. Without these
--    every write answers 42501, "permission denied for table payment_events".
--
--    payments needs update — it already had it from 012, and now genuinely
--    uses it, since a row moves Created -> Paid.
--
--    payment_events is where the grants get interesting. "Append-only" is
--    stated in the comment above, and a comment is not a mechanism. Postgres
--    grants privileges per COLUMN, so append-only is enforceable rather than
--    merely intended: insert and select on the table, update on exactly two
--    columns, delete on none. The payload and the signature verdict are
--    therefore unrewritable by the application that wrote them — not because
--    the code is careful, but because the privilege to rewrite them was never
--    issued. That is the difference between an audit log and a table that
--    currently happens to contain history.
--
--    service_role only throughout. Nothing here is reachable with the anon
--    key, which is the same posture as orders, quote_requests and
--    user_profiles: these rows say what somebody paid and how.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on public.payments to service_role;

grant select, insert on public.payment_events to service_role;
grant update (processed_at, process_error) on public.payment_events to service_role;
-- Deliberately no: delete on payment_events, update on payload / event_id /
-- signature_verified, and nothing at all to anon or authenticated.

do $$
declare
    v_seq text;
begin
    v_seq := pg_get_serial_sequence('public.payment_events', 'id');
    if v_seq is not null then
        execute format('grant usage, select on sequence %s to service_role', v_seq);
    end if;

    v_seq := pg_get_serial_sequence('public.payments', 'id');
    if v_seq is not null then
        execute format('grant usage, select on sequence %s to service_role', v_seq);
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 10. Row level security — closed, same posture as every other table holding
--     customer or financial detail. RLS on with no policies means the service
--     role is the only thing that reaches it.
--
--     Realtime stays off here for the reason 009 wrote down and 013 had to
--     enforce the hard way: Supabase filters realtime delivery through RLS, so
--     subscribing to payment events from a browser would mean granting anon
--     SELECT on them. The anon key is public by definition. A policy on it is
--     a publication.
-- -----------------------------------------------------------------------------
alter table public.payment_events enable row level security;
alter table public.payments       enable row level security;


-- -----------------------------------------------------------------------------
-- 11. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
-- Run these after the file. Every one should come back as described.
--
-- -- 1. The new columns exist, with the right types.
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'payments'
--    and column_name in ('gateway','gateway_order_id','amount_paise',
--                        'currency','verified_at','updated_at')
--  order by column_name;
-- Expected: 6 rows. amount_paise is bigint. gateway is YES-nullable.
--
-- -- 2. The status constraint was actually added, not skipped.
-- --    If this returns 0 rows, scroll back for the NOTICE from section 3 —
-- --    a row is holding a status outside the list and the constraint was
-- --    deliberately not forced over it.
-- select conname from pg_constraint where conname = 'payments_status_check';
-- Expected: 1 row.
--
-- -- 3. Both uniqueness rules are in place. These are the idempotency
-- --    guarantee; a missing one is a silent double-credit waiting to happen.
-- select indexname from pg_indexes
--  where schemaname = 'public' and tablename = 'payments'
--    and indexname in ('payments_transaction_id_key',
--                      'payments_one_paid_per_order_key');
-- Expected: 2 rows.
--
-- -- 4. orders accepts the pre-payment state.
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'orders_status_check';
-- Expected: a CHECK listing five values, including 'Pending Payment'.
--
-- -- 5. Nothing was orphaned by the backfills.
-- select count(*) filter (where gateway is null)      as no_gateway,
--        count(*) filter (where amount_paise is null
--                           and amount is not null)   as no_paise
--   from public.payments;
-- Expected: 0, 0
--
-- -- 6. payment_events is append-only AT THE PRIVILEGE LEVEL, which is the
-- --    only level that counts. This is the check most worth running.
-- select privilege_type, column_name
--   from information_schema.column_privileges
--  where grantee = 'service_role' and table_name = 'payment_events'
--    and privilege_type = 'UPDATE';
-- Expected: exactly two rows — processed_at and process_error. If payload
-- or signature_verified appears here, the audit trail is rewritable and
-- section 9 did not take.
--
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'service_role' and table_name = 'payment_events';
-- Expected: SELECT and INSERT. No DELETE. (Table-level UPDATE is absent by
-- design — it is granted per column above.)
--
-- -- 7. Nothing leaked to the browser's key.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name in ('payments','payment_events')
--    and grantee in ('anon','authenticated');
-- Expected: 0 rows.
-- =============================================================================
