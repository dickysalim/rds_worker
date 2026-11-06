-- Stock tracking: entirely DB-driven. product_stock caches the current balance
-- per sku_id; stock_ledger is the append-only record of every staff-reported
-- movement (new stock received, loss/damage, manual correction). Sales are not
-- duplicated into stock_ledger -- nota_item is already that record for a sale,
-- so a trigger debits product_stock straight from it. Voiding a nota credits
-- the stock back. Nothing here is written by application code; every path
-- (product creation, a staff stock report, a sale, a void) goes through a
-- trigger, so the cache can never drift from forgetting to update it in two
-- places.
--
-- Known limitation: if product or nota_item ever needs a 0015-style rebuild
-- (DROP + recreate, not a plain ALTER TABLE ADD COLUMN), these triggers must
-- be dropped first and recreated after, or the rebuild silently loses them.

CREATE TABLE product_stock (
  sku_id        INTEGER PRIMARY KEY,
  current_stock REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill for every sku_id that already exists (the seed trigger below only
-- fires on future INSERTs into product).
INSERT INTO product_stock (sku_id, current_stock)
SELECT DISTINCT sku_id, 0 FROM product;

CREATE TABLE stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id        INTEGER NOT NULL,
  date          TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_input', 'stock_loss', 'adjustment')),
  qty           REAL NOT NULL CHECK (
    (movement_type = 'stock_input' AND qty > 0) OR
    (movement_type = 'stock_loss' AND qty < 0) OR
    (movement_type = 'adjustment')
  ),
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_ledger_sku ON stock_ledger (sku_id);

-- A product row is inserted on both creation AND every edit (versioning), but
-- product_stock has one row per sku_id forever -- INSERT OR IGNORE means only
-- the first INSERT for a given sku_id actually creates it.
CREATE TRIGGER trg_product_seed_stock
AFTER INSERT ON product
BEGIN
  INSERT OR IGNORE INTO product_stock (sku_id, current_stock) VALUES (NEW.sku_id, 0);
END;

CREATE TRIGGER trg_stock_ledger_apply
AFTER INSERT ON stock_ledger
BEGIN
  UPDATE product_stock
  SET current_stock = current_stock + NEW.qty, updated_at = CURRENT_TIMESTAMP
  WHERE sku_id = NEW.sku_id;
END;

CREATE TRIGGER trg_nota_item_debit_stock
AFTER INSERT ON nota_item
BEGIN
  UPDATE product_stock
  SET current_stock = current_stock - NEW.qty, updated_at = CURRENT_TIMESTAMP
  WHERE sku_id = NEW.sku_id;
END;

-- Voiding a nota reverses every one of its items' debit. One-way only (covers
-- is_void 0 -> 1); there is no un-void flow in this app to handle the reverse.
CREATE TRIGGER trg_nota_void_restock
AFTER UPDATE OF is_void ON nota
WHEN NEW.is_void = 1 AND OLD.is_void = 0
BEGIN
  UPDATE product_stock
  SET current_stock = current_stock + (
        SELECT COALESCE(SUM(ni.qty), 0) FROM nota_item ni
        WHERE ni.nota_id = NEW.nota_id AND ni.sku_id = product_stock.sku_id
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE sku_id IN (SELECT sku_id FROM nota_item WHERE nota_id = NEW.nota_id);
END;
