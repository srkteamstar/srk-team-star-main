-- Quote requests carry an explicit quantity per line.  Earlier rows remain a
-- request for one unit; the application validates the same 1..99 range.
alter table public.quote_request_items
    add column if not exists quantity integer not null default 1;

alter table public.quote_request_items
    drop constraint if exists quote_request_items_quantity_check;

alter table public.quote_request_items
    add constraint quote_request_items_quantity_check
    check (quantity between 1 and 99);

notify pgrst, 'reload schema';
