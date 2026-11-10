-- Adds 'initial_stock' movement type (positive, like production_in) for the
-- Current Stock field on product creation. SQLite CHECK constraints can't be
-- altered in place, so rebuild the table (same pattern as 0026), carrying
-- over the is_active/updated_by/updated_at columns added in 0027.
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

CREATE TABLE stock_ledger_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id        INTEGER NOT NULL,
  date          TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'production_in', 'shipment_return', 'adjust_up', 'initial_stock',
    'stock_loss', 'stock_out', 'stock_defect', 'adjust_down'
  )),
  qty           REAL NOT NULL CHECK (
    (movement_type = 'production_in' AND qty > 0) OR
    (movement_type = 'shipment_return' AND qty > 0) OR
    (movement_type = 'adjust_up' AND qty > 0) OR
    (movement_type = 'initial_stock' AND qty > 0) OR
    (movement_type = 'stock_loss' AND qty < 0) OR
    (movement_type = 'stock_out' AND qty < 0) OR
    (movement_type = 'stock_defect' AND qty < 0) OR
    (movement_type = 'adjust_down' AND qty < 0)
  ),
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active     INTEGER NOT NULL DEFAULT 1,
  updated_by    TEXT,
  updated_at    TEXT
);

INSERT INTO stock_ledger_new (id, sku_id, date, movement_type, qty, note, created_by, created_at, is_active, updated_by, updated_at)
SELECT id, sku_id, date, movement_type, qty, note, created_by, created_at, is_active, updated_by, updated_at
FROM stock_ledger;

DROP TABLE stock_ledger;

ALTER TABLE stock_ledger_new RENAME TO stock_ledger;

CREATE INDEX idx_stock_ledger_sku ON stock_ledger (sku_id);
