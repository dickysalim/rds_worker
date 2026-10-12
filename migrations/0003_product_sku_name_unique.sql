-- product: only one active row per sku_name
CREATE UNIQUE INDEX idx_product_sku_name_active ON product (sku_name) WHERE is_active = 1;
