-- handleListProducts' total_revenue correlated subquery filters nota_item by sku_id
-- (JOIN nota_item ni ... WHERE ni.sku_id = product.sku_id) with no index backing it —
-- idx_nota_item_nota only covers nota_id. Full nota_item scan per product row otherwise.
CREATE INDEX idx_nota_item_sku ON nota_item (sku_id);
