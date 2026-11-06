-- Snapshot of product.cost_price at the time the nota_item was created, same
-- spirit as item_name_snapshot/unit_snapshot/price. Lets margin reporting
-- read historical cost without depending on product's current (versioned) row.
ALTER TABLE nota_item ADD COLUMN cost_price_snapshot INTEGER;
