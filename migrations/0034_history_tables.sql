-- Audit history, trigger-written, for every editable-content table: business,
-- nota, stock_ledger, product, customer. Every INSERT/UPDATE on the main table
-- fires an AFTER trigger that appends a full-row snapshot into <table>_history,
-- tagged with action ('create'/'update'/'migration'), changed_by, changed_at.
--
-- product and customer stop being append-only (one row per edit, distinguished
-- by is_active) and go back to one row per sku_id/customer_id, updated in
-- place -- the version trail now lives in product_history/customer_history
-- instead of in the main table.
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

-- ---------------------------------------------------------------------------
-- business: add missing audit columns, then history + triggers.
-- ---------------------------------------------------------------------------

ALTER TABLE business ADD COLUMN updated_by TEXT;

ALTER TABLE business ADD COLUMN updated_at TEXT;

CREATE TABLE business_history (
  history_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id             INTEGER NOT NULL,
  business_name           TEXT,
  business_address        TEXT,
  business_contact_number TEXT,
  business_email          TEXT,
  business_logo_key       TEXT,
  business_contact_person TEXT,
  payment_bank_name       TEXT,
  payment_account_name    TEXT,
  payment_account_number  TEXT,
  is_active               INTEGER,
  action                  TEXT NOT NULL,
  changed_by              TEXT,
  changed_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_history_business ON business_history (business_id);

INSERT INTO business_history (
  business_id, business_name, business_address, business_contact_number, business_email,
  business_logo_key, business_contact_person, payment_bank_name, payment_account_name,
  payment_account_number, is_active, action, changed_by, changed_at
)
SELECT
  business_id, business_name, business_address, business_contact_number, business_email,
  business_logo_key, business_contact_person, payment_bank_name, payment_account_name,
  payment_account_number, is_active, 'migration', 'migration', CURRENT_TIMESTAMP
FROM business;

CREATE TRIGGER trg_business_history_insert
AFTER INSERT ON business
BEGIN
  INSERT INTO business_history (
    business_id, business_name, business_address, business_contact_number, business_email,
    business_logo_key, business_contact_person, payment_bank_name, payment_account_name,
    payment_account_number, is_active, action, changed_by, changed_at
  )
  VALUES (
    NEW.business_id, NEW.business_name, NEW.business_address, NEW.business_contact_number, NEW.business_email,
    NEW.business_logo_key, NEW.business_contact_person, NEW.payment_bank_name, NEW.payment_account_name,
    NEW.payment_account_number, NEW.is_active, 'create', NEW.updated_by, CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER trg_business_history_update
AFTER UPDATE ON business
BEGIN
  INSERT INTO business_history (
    business_id, business_name, business_address, business_contact_number, business_email,
    business_logo_key, business_contact_person, payment_bank_name, payment_account_name,
    payment_account_number, is_active, action, changed_by, changed_at
  )
  VALUES (
    NEW.business_id, NEW.business_name, NEW.business_address, NEW.business_contact_number, NEW.business_email,
    NEW.business_logo_key, NEW.business_contact_person, NEW.payment_bank_name, NEW.payment_account_name,
    NEW.payment_account_number, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP
  );
END;

-- ---------------------------------------------------------------------------
-- nota: add missing audit columns, then history + triggers.
-- ---------------------------------------------------------------------------

ALTER TABLE nota ADD COLUMN updated_by TEXT;

ALTER TABLE nota ADD COLUMN updated_at TEXT;

CREATE TABLE nota_history (
  history_id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id                        INTEGER NOT NULL,
  nota_number                    TEXT,
  nota_date                      TEXT,
  customer_id                    INTEGER,
  customer_company_name_snapshot TEXT,
  customer_address_snapshot      TEXT,
  contact_name_snapshot          TEXT,
  contact_phone_number_snapshot  TEXT,
  total_price                    INTEGER,
  is_void                        INTEGER,
  notes                          TEXT,
  business_id                    INTEGER,
  pajak_name                     TEXT,
  pajak_percentage               REAL,
  pdf_r2_key                     TEXT,
  action                         TEXT NOT NULL,
  changed_by                     TEXT,
  changed_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nota_history_nota ON nota_history (nota_id);

INSERT INTO nota_history (
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, is_void, notes, business_id, pajak_name, pajak_percentage, pdf_r2_key,
  action, changed_by, changed_at
)
SELECT
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, is_void, notes, business_id, pajak_name, pajak_percentage, pdf_r2_key,
  'migration', created_by, CURRENT_TIMESTAMP
FROM nota;

CREATE TRIGGER trg_nota_history_insert
AFTER INSERT ON nota
BEGIN
  INSERT INTO nota_history (
    nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
    customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
    total_price, is_void, notes, business_id, pajak_name, pajak_percentage, pdf_r2_key,
    action, changed_by, changed_at
  )
  VALUES (
    NEW.nota_id, NEW.nota_number, NEW.nota_date, NEW.customer_id, NEW.customer_company_name_snapshot,
    NEW.customer_address_snapshot, NEW.contact_name_snapshot, NEW.contact_phone_number_snapshot,
    NEW.total_price, NEW.is_void, NEW.notes, NEW.business_id, NEW.pajak_name, NEW.pajak_percentage, NEW.pdf_r2_key,
    'create', NEW.created_by, CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER trg_nota_history_update
AFTER UPDATE ON nota
BEGIN
  INSERT INTO nota_history (
    nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
    customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
    total_price, is_void, notes, business_id, pajak_name, pajak_percentage, pdf_r2_key,
    action, changed_by, changed_at
  )
  VALUES (
    NEW.nota_id, NEW.nota_number, NEW.nota_date, NEW.customer_id, NEW.customer_company_name_snapshot,
    NEW.customer_address_snapshot, NEW.contact_name_snapshot, NEW.contact_phone_number_snapshot,
    NEW.total_price, NEW.is_void, NEW.notes, NEW.business_id, NEW.pajak_name, NEW.pajak_percentage, NEW.pdf_r2_key,
    'update', NEW.updated_by, CURRENT_TIMESTAMP
  );
END;

-- ---------------------------------------------------------------------------
-- stock_ledger: already one row per entry, updated in place -- just add
-- history + triggers, no rebuild.
-- ---------------------------------------------------------------------------

CREATE TABLE stock_ledger_history (
  history_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  id            INTEGER NOT NULL,
  sku_id        INTEGER NOT NULL,
  date          TEXT,
  movement_type TEXT,
  qty           REAL,
  note          TEXT,
  is_active     INTEGER,
  action        TEXT NOT NULL,
  changed_by    TEXT,
  changed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_ledger_history_id ON stock_ledger_history (id);

INSERT INTO stock_ledger_history (id, sku_id, date, movement_type, qty, note, is_active, action, changed_by, changed_at)
SELECT id, sku_id, date, movement_type, qty, note, is_active, 'migration', COALESCE(updated_by, created_by), CURRENT_TIMESTAMP
FROM stock_ledger;

CREATE TRIGGER trg_stock_ledger_history_insert
AFTER INSERT ON stock_ledger
BEGIN
  INSERT INTO stock_ledger_history (id, sku_id, date, movement_type, qty, note, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.sku_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.is_active, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_stock_ledger_history_update
AFTER UPDATE ON stock_ledger
BEGIN
  INSERT INTO stock_ledger_history (id, sku_id, date, movement_type, qty, note, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.sku_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;

-- ---------------------------------------------------------------------------
-- product: collapse append-only rows down to one row per sku_id. Every
-- existing version (every row, every sku_id) is preserved in product_history
-- first; the main table then keeps only the latest row per sku_id.
-- ---------------------------------------------------------------------------

CREATE TABLE product_history (
  history_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id          INTEGER NOT NULL,
  sku_name        TEXT,
  unit            TEXT,
  suggested_price INTEGER,
  cost_price      INTEGER,
  is_active       INTEGER,
  action          TEXT NOT NULL,
  changed_by      TEXT,
  changed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_history_sku ON product_history (sku_id);

INSERT INTO product_history (sku_id, sku_name, unit, suggested_price, cost_price, is_active, action, changed_by, changed_at)
SELECT sku_id, sku_name, unit, suggested_price, cost_price, is_active, 'migration', updated_by, updated_at
FROM product
ORDER BY row_increment;

CREATE TABLE product_new (
  sku_id          INTEGER PRIMARY KEY,
  sku_name        TEXT NOT NULL,
  unit            TEXT NOT NULL,
  suggested_price INTEGER,
  cost_price      INTEGER,
  updated_by      TEXT,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active       INTEGER NOT NULL DEFAULT 1
);

INSERT INTO product_new (sku_id, sku_name, unit, suggested_price, cost_price, updated_by, updated_at, is_active)
SELECT sku_id, sku_name, unit, suggested_price, cost_price, updated_by, updated_at, is_active
FROM product
WHERE row_increment IN (SELECT MAX(row_increment) FROM product GROUP BY sku_id);

DROP TABLE product;

ALTER TABLE product_new RENAME TO product;

CREATE UNIQUE INDEX idx_product_sku_name_active ON product (sku_name) WHERE is_active = 1;

CREATE TRIGGER trg_product_history_insert
AFTER INSERT ON product
BEGIN
  INSERT INTO product_history (sku_id, sku_name, unit, suggested_price, cost_price, is_active, action, changed_by, changed_at)
  VALUES (NEW.sku_id, NEW.sku_name, NEW.unit, NEW.suggested_price, NEW.cost_price, NEW.is_active, 'create', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_product_history_update
AFTER UPDATE ON product
BEGIN
  INSERT INTO product_history (sku_id, sku_name, unit, suggested_price, cost_price, is_active, action, changed_by, changed_at)
  VALUES (NEW.sku_id, NEW.sku_name, NEW.unit, NEW.suggested_price, NEW.cost_price, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;

-- ---------------------------------------------------------------------------
-- customer: same collapse as product.
-- ---------------------------------------------------------------------------

CREATE TABLE customer_history (
  history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL,
  company_name   TEXT,
  address        TEXT,
  contact_person TEXT,
  phone_number   TEXT,
  is_active      INTEGER,
  action         TEXT NOT NULL,
  changed_by     TEXT,
  changed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customer_history_customer ON customer_history (customer_id);

INSERT INTO customer_history (customer_id, company_name, address, contact_person, phone_number, is_active, action, changed_by, changed_at)
SELECT customer_id, company_name, address, contact_person, phone_number, is_active, 'migration', updated_by, updated_at
FROM customer
ORDER BY row_increment;

CREATE TABLE customer_new (
  customer_id    INTEGER PRIMARY KEY,
  company_name   TEXT NOT NULL,
  address        TEXT,
  contact_person TEXT,
  phone_number   TEXT,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active      INTEGER NOT NULL DEFAULT 1
);

INSERT INTO customer_new (customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active)
SELECT customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active
FROM customer
WHERE row_increment IN (SELECT MAX(row_increment) FROM customer GROUP BY customer_id);

DROP TABLE customer;

ALTER TABLE customer_new RENAME TO customer;

CREATE INDEX idx_customer_customer_id ON customer (customer_id);
CREATE UNIQUE INDEX idx_customer_company_name_active ON customer (company_name) WHERE is_active = 1;
CREATE UNIQUE INDEX idx_customer_phone_active ON customer (phone_number) WHERE is_active = 1;

CREATE TRIGGER trg_customer_history_insert
AFTER INSERT ON customer
BEGIN
  INSERT INTO customer_history (customer_id, company_name, address, contact_person, phone_number, is_active, action, changed_by, changed_at)
  VALUES (NEW.customer_id, NEW.company_name, NEW.address, NEW.contact_person, NEW.phone_number, NEW.is_active, 'create', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_customer_history_update
AFTER UPDATE ON customer
BEGIN
  INSERT INTO customer_history (customer_id, company_name, address, contact_person, phone_number, is_active, action, changed_by, changed_at)
  VALUES (NEW.customer_id, NEW.company_name, NEW.address, NEW.contact_person, NEW.phone_number, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;
