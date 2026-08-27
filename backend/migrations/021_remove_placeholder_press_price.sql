-- The MDF Hook Press Toggle Machine was seeded at ₹10 only to exercise the
-- checkout path. It is not a commercial price. Keep the row published but
-- make it quote-only until an administrator enters the confirmed price.
update public.products
set price = 'On request', updated_at = now()
where id = 9
  and trim(price::text) in ('10', '10.0', '10.00');
