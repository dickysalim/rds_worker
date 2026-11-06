-- harga modal / cost price: what the business pays to acquire or produce the
-- item, as opposed to suggested_price (what it sells for). Needed for margin
-- reporting; not yet surfaced in any UI.
ALTER TABLE product ADD COLUMN cost_price INTEGER;
