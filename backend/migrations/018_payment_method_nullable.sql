-- =============================================================================
-- 018_payment_method_nullable.sql — the instrument is not known at order time
-- =============================================================================
--
-- Run after 017. Idempotent — safe to re-run.
--
-- WHAT BROKE
-- ----------
-- The first real test payment failed at checkout with:
--
--   23502  null value in column "payment_method" of relation "payments"
--          violates not-null constraint
--
-- and POST /api/checkout did the right thing with it — cancelled the order it
-- had already written rather than leaving one that looked placed, and told the
-- customer nothing had been charged. Which was true: the failure happens
-- before the Razorpay order is created, so no money was ever in play.
--
-- WHY THE CODE IS RIGHT AND THE COLUMN IS WRONG
-- ---------------------------------------------
-- `payment_method` is the *instrument* — card / upi / netbanking / wallet /
-- emi. 014 says exactly that, and widened what the column means:
--
--     'Instrument: card / upi / netbanking / wallet / emi for a gateway
--      payment, Offline for one the sales team settles.'
--
-- What 014 did not do is drop the NOT NULL that the column carried from the
-- era when the only possible value was 'Offline'. Under a gateway the
-- instrument is genuinely unknown when the row is written: the payments row is
-- created BEFORE the customer is shown the modal — that ordering is the
-- security model, money must never be able to move against an order that does
-- not exist yet — and the customer has not chosen how to pay at that point.
--
-- So the lifecycle the code implements is:
--
--   POST /api/checkout   payment_method = null       (nobody has chosen yet)
--   markOrderPaid()      payment_method = gatewayPayment.method
--                                                    (what Razorpay OBSERVED)
--
-- NOT NULL made the first step impossible, and there is no honest value to put
-- there instead.
--
-- WHY NOT A PLACEHOLDER DEFAULT
-- -----------------------------
-- 'Unknown', 'Pending' or defaulting to 'Offline' would all satisfy the
-- constraint and all be worse. This is 014's own reasoning for leaving
-- `gateway` nullable with no default, and it applies here unchanged:
--
--     'A null is visible; a plausible wrong default is not. Loud beats tidy
--      where money is concerned.'
--
-- Defaulting to 'Offline' in particular would file real card payments as
-- offline ones and drop them out of every reconciliation query that filters on
-- the instrument. A null cannot be mistaken for a fact.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not make the column optional in practice. Every offline row still
-- gets a real value from PAYMENT_METHODS in server.js, and every gateway row
-- gets one the moment the payment is captured. A row left null after capture
-- would mean markOrderPaid() never ran — which is a state worth being able to
-- SELECT for, and the verify query at the bottom does exactly that.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the constraint
--
--    Guarded rather than unconditional: `alter column ... drop not null` is
--    not an error on a column that is already nullable, but checking first
--    keeps a re-run silent instead of merely harmless, and makes the intent
--    legible to anyone reading the file rather than the diff.
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'payments'
           and column_name  = 'payment_method'
           and is_nullable  = 'NO'
    ) then
        alter table public.payments alter column payment_method drop not null;
        raise notice 'payments.payment_method is now nullable.';
    else
        raise notice 'payments.payment_method was already nullable; nothing to do.';
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Say what null means, so the next reader does not have to infer it
-- -----------------------------------------------------------------------------
comment on column public.payments.payment_method is
    'Instrument: card / upi / netbanking / wallet / emi for a gateway payment, or one of the offline methods for a row the sales team settles. NULL means a gateway payment that has not been captured yet — the customer had not chosen when the row was written. markOrderPaid() fills it in with what Razorpay observed. NULL on a Paid row is a defect.';


-- -----------------------------------------------------------------------------
-- 3. Refresh PostgREST's schema cache immediately.
--
--    Not optional here. PostgREST caches nullability and will keep rejecting
--    the insert with the same 23502 until it reloads, which looks exactly like
--    the migration not having worked.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The constraint is gone.
-- select column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'payments'
--    and column_name = 'payment_method';
-- Expected: payment_method | YES
--
-- -- 2. Nothing that is already paid lost its instrument.
-- select id, order_id, status, gateway, payment_method
--   from public.payments
--  where status = 'Paid' and payment_method is null;
-- Expected: 0 rows. A row here means markOrderPaid() did not run for a payment
-- that is nonetheless marked Paid — investigate before trusting the total.
--
-- -- 3. The expected in-flight state: created, unpaid, instrument not yet known.
-- select id, order_id, status, gateway, payment_method, verified_at
--   from public.payments
--  where payment_method is null;
-- Expected: only rows with status 'Created' (a customer mid-checkout, or one
-- who closed the modal). Anything else null here is worth a look.
-- =============================================================================
