-- Raw material tracking: same shape as product/product_stock/stock_ledger.
-- raw_material is the master list (one row per material, updated in place,
-- full version trail in raw_material_history). raw_material_stock caches the
-- current balance per raw_mat_id, kept in sync purely by trigger off
-- raw_material_ledger inserts -- application code never writes it directly.
--
-- movement_type covers the raw-material domain (inverse of stock_ledger's
-- sales domain): purchase_in (+) is receiving stock from a vendor;
-- out_for_production (-) is consuming it into making product; retur (-) is
-- returning defective/wrong stock to the vendor; stock_loss (-) is damage/
-- shrinkage. price is the rate paid that batch -- only meaningful on
-- purchase_in rows, NULL otherwise. purchase_order_id is a plain unenforced
-- link (no purchase_order table yet), same "snapshot over FK" spirit as the
-- rest of this schema.
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

CREATE TABLE raw_material (
  raw_mat_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_mat_sku_name TEXT NOT NULL,
  unit             TEXT NOT NULL,
  updated_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active        INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_raw_material_sku_name_active ON raw_material (raw_mat_sku_name) WHERE is_active = 1;

CREATE TABLE raw_material_stock (
  raw_mat_id    INTEGER PRIMARY KEY,
  current_stock REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seeds a stock row the moment a raw material is created (mirrors
-- trg_product_seed_stock). INSERT OR IGNORE: if raw_material is ever
-- versioned like product/customer were, re-inserts for the same id no-op.
CREATE TRIGGER trg_raw_material_seed_stock
AFTER INSERT ON raw_material
BEGIN
  INSERT OR IGNORE INTO raw_material_stock (raw_mat_id, current_stock) VALUES (NEW.raw_mat_id, 0);
END;

CREATE TABLE raw_material_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_mat_id        INTEGER NOT NULL,
  date              TEXT NOT NULL,
  movement_type     TEXT NOT NULL CHECK (movement_type IN (
    'purchase_in', 'out_for_production', 'retur', 'stock_loss'
  )),
  qty               REAL NOT NULL CHECK (
    (movement_type = 'purchase_in'        AND qty > 0) OR
    (movement_type = 'out_for_production' AND qty < 0) OR
    (movement_type = 'retur'              AND qty < 0) OR
    (movement_type = 'stock_loss'         AND qty < 0)
  ),
  note              TEXT,
  purchase_order_id INTEGER,
  price             INTEGER,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active         INTEGER NOT NULL DEFAULT 1,
  updated_by        TEXT,
  updated_at        TEXT
);

CREATE INDEX idx_raw_material_ledger_raw_mat ON raw_material_ledger (raw_mat_id);

CREATE TRIGGER trg_raw_material_ledger_apply
AFTER INSERT ON raw_material_ledger
BEGIN
  UPDATE raw_material_stock
  SET current_stock = current_stock + NEW.qty, updated_at = CURRENT_TIMESTAMP
  WHERE raw_mat_id = NEW.raw_mat_id;
END;

-- Audit history, trigger-written, same pattern as 0034.

CREATE TABLE raw_material_history (
  history_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_mat_id       INTEGER NOT NULL,
  raw_mat_sku_name TEXT,
  unit             TEXT,
  is_active        INTEGER,
  action           TEXT NOT NULL,
  changed_by       TEXT,
  changed_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_raw_material_history_raw_mat ON raw_material_history (raw_mat_id);

CREATE TRIGGER trg_raw_material_history_insert
AFTER INSERT ON raw_material
BEGIN
  INSERT INTO raw_material_history (raw_mat_id, raw_mat_sku_name, unit, is_active, action, changed_by, changed_at)
  VALUES (NEW.raw_mat_id, NEW.raw_mat_sku_name, NEW.unit, NEW.is_active, 'create', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_raw_material_history_update
AFTER UPDATE ON raw_material
BEGIN
  INSERT INTO raw_material_history (raw_mat_id, raw_mat_sku_name, unit, is_active, action, changed_by, changed_at)
  VALUES (NEW.raw_mat_id, NEW.raw_mat_sku_name, NEW.unit, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TABLE raw_material_ledger_history (
  history_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  id                INTEGER NOT NULL,
  raw_mat_id        INTEGER NOT NULL,
  date              TEXT,
  movement_type     TEXT,
  qty               REAL,
  note              TEXT,
  purchase_order_id INTEGER,
  price             INTEGER,
  is_active         INTEGER,
  action            TEXT NOT NULL,
  changed_by        TEXT,
  changed_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_raw_material_ledger_history_id ON raw_material_ledger_history (id);

CREATE TRIGGER trg_raw_material_ledger_history_insert
AFTER INSERT ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.price, NEW.is_active, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_raw_material_ledger_history_update
AFTER UPDATE ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.price, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;
