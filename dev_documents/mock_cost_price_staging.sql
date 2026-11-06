-- Mock data only: cost_price ~65% of suggested_price, rounded. Run on staging only.
UPDATE product SET cost_price = 1000   WHERE sku_id = 1  AND is_active = 1;
UPDATE product SET cost_price = 1500   WHERE sku_id = 2  AND is_active = 1;
UPDATE product SET cost_price = 120000 WHERE sku_id = 3  AND is_active = 1;
UPDATE product SET cost_price = 160000 WHERE sku_id = 4  AND is_active = 1;
UPDATE product SET cost_price = 550    WHERE sku_id = 5  AND is_active = 1;
UPDATE product SET cost_price = 900    WHERE sku_id = 6  AND is_active = 1;
UPDATE product SET cost_price = 1800   WHERE sku_id = 7  AND is_active = 1;
UPDATE product SET cost_price = 1200   WHERE sku_id = 8  AND is_active = 1;
UPDATE product SET cost_price = 29000  WHERE sku_id = 9  AND is_active = 1;
UPDATE product SET cost_price = 2100   WHERE sku_id = 10 AND is_active = 1;
UPDATE product SET cost_price = 1300   WHERE sku_id = 11 AND is_active = 1;
UPDATE product SET cost_price = 2500   WHERE sku_id = 12 AND is_active = 1;
