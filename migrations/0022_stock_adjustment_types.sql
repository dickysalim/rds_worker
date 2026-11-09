-- Splits the generic 'adjustment' movement_type into 'adjust_up'/'adjust_down'
-- so the sign is encoded in the type itself (matches stock_input/stock_loss).
-- SQLite CHECK constraints can't be altered in place, so this rebuilds
-- stock_ledger -- trg_stock_ledger_apply targets this table and must be
-- dropped first and recreated after, per the 0019 caveat.

DROP TRIGGER trg_stock_ledger_apply;

CREATE TABLE stock_ledger_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id        INTEGER NOT NULL,
  date          TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_input', 'stock_loss', 'adjust_up', 'adjust_down')),
  qty           REAL NOT NULL CHECK (
    (movement_type = 'stock_input' AND qty > 0) OR
    (movement_type = 'stock_loss' AND qty < 0) OR
    (movement_type = 'adjust_up' AND qty > 0) OR
    (movement_type = 'adjust_down' AND qty < 0)
  ),
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stock_ledger_new (id, sku_id, date, movement_type, qty, note, created_by, created_at)
SELECT id, sku_id, date,
  CASE
    WHEN movement_type = 'adjustment' AND qty >= 0 THEN 'adjust_up'
    WHEN movement_type = 'adjustment' AND qty < 0 THEN 'adjust_down'
    ELSE movement_type
  END,
  qty, note, created_by, created_at
FROM stock_ledger;

DROP TABLE stock_ledger;
ALTER TABLE stock_ledger_new RENAME TO stock_ledger;

CREATE INDEX idx_stock_ledger_sku ON stock_ledger (sku_id);

CREATE TRIGGER trg_stock_ledger_apply
AFTER INSERT ON stock_ledger
BEGIN
  UPDATE product_stock
  SET current_stock = current_stock + NEW.qty, updated_at = CURRENT_TIMESTAMP
  WHERE sku_id = NEW.sku_id;
END;
