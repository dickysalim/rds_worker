-- Backfill existing nota_item rows with cost_price_snapshot, using each
-- item's sku_id to look up the current active product's cost_price (the
-- mock values already set by mock_cost_price_staging.sql). Run after 0020
-- is applied. Safe to run on prod too -- formula-based, no hardcoded ids.
UPDATE nota_item
SET cost_price_snapshot = (
  SELECT cost_price FROM product
  WHERE product.sku_id = nota_item.sku_id AND product.is_active = 1
)
WHERE cost_price_snapshot IS NULL;
