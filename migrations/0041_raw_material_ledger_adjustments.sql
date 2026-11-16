-- Adds 'initial_stock', 'adjustment_up', 'adjustment_down' movement types.
-- initial_stock replaces the 'purchase_in' that handleCreateRawMaterial used
-- to hardcode for the Current Stock field on raw material creation, so it can
-- now carry its own optional price and show up in Price Management on its
-- own (not lumped in with real vendor purchases). adjustment_up/down are
-- manual corrections for miscounted stock, never priced.
--
-- SQLite CHECK constraints can't be altered in place, so rebuild the table
-- (same pattern as 0033), carrying over every column added since 0035
-- (purchase_order_freetext from 0040), and recreating the triggers/index
-- that DROP TABLE takes with it.
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.
--
-- trg_raw_material_deactivate_cascade (0036) lives on raw_material but
-- references raw_material_ledger in its body -- D1 revalidates it mid-batch
-- while this table is briefly gone, so drop it first and recreate it last.

DROP TRIGGER trg_raw_material_deactivate_cascade;

CREATE TABLE raw_material_ledger_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_mat_id              INTEGER NOT NULL,
  date                    TEXT NOT NULL,
  movement_type           TEXT NOT NULL CHECK (movement_type IN (
    'purchase_in', 'out_for_production', 'retur', 'stock_loss',
    'initial_stock', 'adjustment_up', 'adjustment_down'
  )),
  qty                     REAL NOT NULL CHECK (
    (movement_type = 'purchase_in'        AND qty > 0) OR
    (movement_type = 'out_for_production' AND qty < 0) OR
    (movement_type = 'retur'              AND qty < 0) OR
    (movement_type = 'stock_loss'         AND qty < 0) OR
    (movement_type = 'initial_stock'      AND qty > 0) OR
    (movement_type = 'adjustment_up'      AND qty > 0) OR
    (movement_type = 'adjustment_down'    AND qty < 0)
  ),
  note                    TEXT,
  purchase_order_id       INTEGER,
  price                   INTEGER,
  created_by              TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active               INTEGER NOT NULL DEFAULT 1,
  updated_by              TEXT,
  updated_at              TEXT,
  purchase_order_freetext TEXT
);

INSERT INTO raw_material_ledger_new (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, price, created_by, created_at, is_active, updated_by, updated_at, purchase_order_freetext)
SELECT id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, price, created_by, created_at, is_active, updated_by, updated_at, purchase_order_freetext
FROM raw_material_ledger;

DROP TABLE raw_material_ledger;

ALTER TABLE raw_material_ledger_new RENAME TO raw_material_ledger;

CREATE INDEX idx_raw_material_ledger_raw_mat ON raw_material_ledger (raw_mat_id);

CREATE TRIGGER trg_raw_material_ledger_apply
AFTER INSERT ON raw_material_ledger
BEGIN
  UPDATE raw_material_stock
  SET current_stock = current_stock + NEW.qty, updated_at = CURRENT_TIMESTAMP
  WHERE raw_mat_id = NEW.raw_mat_id;
END;

CREATE TRIGGER trg_raw_material_ledger_history_insert
AFTER INSERT ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, purchase_order_freetext, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.purchase_order_freetext, NEW.price, NEW.is_active, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_raw_material_ledger_history_update
AFTER UPDATE ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, purchase_order_freetext, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.purchase_order_freetext, NEW.price, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_raw_material_deactivate_cascade
AFTER UPDATE OF is_active ON raw_material
WHEN NEW.is_active = 0 AND OLD.is_active = 1
BEGIN
  UPDATE raw_material_ledger
  SET is_active = 0, updated_by = NEW.updated_by, updated_at = CURRENT_TIMESTAMP
  WHERE raw_mat_id = NEW.raw_mat_id AND is_active = 1;
END;
