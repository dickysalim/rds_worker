-- Two changes bundled together:
--
-- 1. current_stock stops being a trigger-maintained cache (product_stock)
--    and becomes a live computed value: SUM(stock_ledger.qty) -
--    SUM(nota_item.qty for non-void nota) -- see handleListProducts in
--    src/index.ts. Removes product_stock and all four stock triggers, and
--    with them the "triggers must be dropped/recreated on every table
--    rebuild" caveat that's bitten every stock migration since 0019.
--
-- 2. Movement types restructured for a real production flow:
--    - stock_input renamed to production_in (QC-passed output only)
--    - new plus type: shipment_return (customer sends an item back)
--    - new minus types: stock_out (personal/take-home draw), stock_defect
--      (defective item written off, typically after a shipment_return)
--    - stock_loss, adjust_up, adjust_down unchanged
--    (production reject / QC reject tracking is pinned -- not part of this
--    migration.)
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

DROP TRIGGER trg_product_seed_stock;

DROP TRIGGER trg_stock_ledger_apply;

DROP TRIGGER trg_nota_item_debit_stock;

DROP TRIGGER trg_nota_void_restock;

DROP TABLE product_stock;

CREATE TABLE stock_ledger_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id        INTEGER NOT NULL,
  date          TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'production_in', 'shipment_return', 'adjust_up',
    'stock_loss', 'stock_out', 'stock_defect', 'adjust_down'
  )),
  qty           REAL NOT NULL CHECK (
    (movement_type = 'production_in' AND qty > 0) OR
    (movement_type = 'shipment_return' AND qty > 0) OR
    (movement_type = 'adjust_up' AND qty > 0) OR
    (movement_type = 'stock_loss' AND qty < 0) OR
    (movement_type = 'stock_out' AND qty < 0) OR
    (movement_type = 'stock_defect' AND qty < 0) OR
    (movement_type = 'adjust_down' AND qty < 0)
  ),
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stock_ledger_new (id, sku_id, date, movement_type, qty, note, created_by, created_at)
SELECT id, sku_id, date,
  CASE WHEN movement_type = 'stock_input' THEN 'production_in' ELSE movement_type END,
  qty, note, created_by, created_at
FROM stock_ledger;

DROP TABLE stock_ledger;

ALTER TABLE stock_ledger_new RENAME TO stock_ledger;

CREATE INDEX idx_stock_ledger_sku ON stock_ledger (sku_id);
