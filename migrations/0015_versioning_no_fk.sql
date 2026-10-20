-- customer, product, nota and payment become append-only, versioned tables: every edit
-- appends a new row instead of overwriting, grouped by a stable id (customer_id/sku_id),
-- with only one active row per group at a time. customer_contact is dropped (merged into
-- customer: one contact per customer row is enough).
--
-- No table declares a foreign key any more. customer_id/sku_id become non-unique once
-- versioned, which breaks SQLite's FK requirement that a referenced column be unique --
-- and D1 does not reliably let a migration file disable FK enforcement for its own
-- in-flight table rebuild (confirmed by repeated SQLITE_CONSTRAINT_FOREIGNKEY failures
-- here), so every cross-table link becomes a plain, unenforced integer column instead.
-- nota/nota_item/payment already carry their own snapshot columns, so nothing downstream
-- depends on these being real FKs.
--
-- Built as parallel tables (customer_v2, product_v2, nota_v2, nota_item_v2, payment_v2),
-- all populated while the real tables are still untouched, then the real tables are
-- dropped in child-before-parent order (payment, nota_item, nota, customer_contact,
-- product, customer) so nothing is ever dropped while something still references it,
-- and only then renamed into place. This does not depend on any PRAGMA behaving a
-- particular way.

DROP VIEW nota_summary;

CREATE TABLE customer_v2 (
  row_increment  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL,
  company_name   TEXT NOT NULL,
  address        TEXT,
  contact_person TEXT,
  phone_number   TEXT,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active      INTEGER NOT NULL DEFAULT 1
);

INSERT INTO customer_v2 (customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active)
SELECT c.customer_id, c.company_name, c.address, cc.contact_name, cc.phone_number,
       'migration', CURRENT_TIMESTAMP, c.is_active
FROM customer c
LEFT JOIN customer_contact cc ON cc.customer_id = c.customer_id AND cc.is_primary = 1;

CREATE TABLE product_v2 (
  row_increment   INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id          INTEGER NOT NULL,
  sku_name        TEXT NOT NULL,
  unit            TEXT NOT NULL,
  suggested_price INTEGER,
  updated_by      TEXT,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active       INTEGER NOT NULL DEFAULT 1
);

INSERT INTO product_v2 (sku_id, sku_name, unit, suggested_price, updated_by, updated_at, is_active)
SELECT sku_id, sku_name, unit, suggested_price, 'migration', CURRENT_TIMESTAMP, is_active
FROM product;

CREATE TABLE nota_v2 (
  nota_id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_number                    TEXT NOT NULL UNIQUE,
  nota_date                      TEXT NOT NULL,
  customer_id                    INTEGER NOT NULL,
  customer_company_name_snapshot TEXT NOT NULL,
  customer_address_snapshot      TEXT,
  contact_name_snapshot          TEXT NOT NULL,
  contact_phone_number_snapshot  TEXT NOT NULL,
  total_price                    INTEGER NOT NULL,
  created_by                     INTEGER NOT NULL,
  is_void                        INTEGER NOT NULL DEFAULT 0,
  created_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pdf_r2_key                     TEXT
);

INSERT INTO nota_v2 (
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, created_by, is_void, created_at, pdf_r2_key
)
SELECT
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, created_by, is_void, created_at, pdf_r2_key
FROM nota;

CREATE TABLE nota_item_v2 (
  nota_item_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id            INTEGER NOT NULL,
  sku_id             INTEGER NOT NULL,
  item_name_snapshot TEXT NOT NULL,
  unit_snapshot      TEXT NOT NULL,
  qty                REAL NOT NULL,
  price              INTEGER NOT NULL,
  discount_amount    INTEGER NOT NULL DEFAULT 0,
  total_price        INTEGER NOT NULL,
  discount_percent   REAL NOT NULL DEFAULT 0
);

INSERT INTO nota_item_v2 (
  nota_item_id, nota_id, sku_id, item_name_snapshot, unit_snapshot, qty, price,
  discount_amount, total_price, discount_percent
)
SELECT
  nota_item_id, nota_id, sku_id, item_name_snapshot, unit_snapshot, qty, price,
  discount_amount, total_price, discount_percent
FROM nota_item;

CREATE TABLE payment_v2 (
  payment_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_date   TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  method         TEXT,
  reference      TEXT,
  is_void        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_key   TEXT,
  payment_number TEXT,
  customer_id    INTEGER,
  bill_year      INTEGER,
  bill_month     INTEGER
);

INSERT INTO payment_v2 (
  payment_id, payment_date, amount, method, reference, is_void, created_at,
  evidence_key, payment_number, customer_id, bill_year, bill_month
)
SELECT
  payment_id, payment_date, amount, method, reference, is_void, created_at,
  evidence_key, payment_number, customer_id, bill_year, bill_month
FROM payment;

-- Drop originals child-before-parent so nothing is dropped while still referenced.
DROP TABLE payment;
DROP TABLE nota_item;
DROP TABLE nota;
DROP TABLE customer_contact;
DROP TABLE product;
DROP TABLE customer;

ALTER TABLE customer_v2 RENAME TO customer;
ALTER TABLE product_v2 RENAME TO product;
ALTER TABLE nota_v2 RENAME TO nota;
ALTER TABLE nota_item_v2 RENAME TO nota_item;
ALTER TABLE payment_v2 RENAME TO payment;

CREATE INDEX idx_customer_customer_id ON customer (customer_id);
CREATE UNIQUE INDEX idx_customer_company_name_active ON customer (company_name) WHERE is_active = 1;
CREATE UNIQUE INDEX idx_customer_phone_active ON customer (phone_number) WHERE is_active = 1;

CREATE INDEX idx_product_sku_id ON product (sku_id);
CREATE UNIQUE INDEX idx_product_sku_name_active ON product (sku_name) WHERE is_active = 1;

CREATE INDEX idx_nota_customer ON nota (customer_id);
CREATE INDEX idx_nota_item_nota ON nota_item (nota_id);
CREATE INDEX idx_payment_bill ON payment (customer_id, bill_year, bill_month);

CREATE VIEW nota_summary AS
WITH bill_nota AS (
  SELECT
    nota_id,
    customer_id,
    CAST(substr(nota_date, 1, 4) AS INTEGER) AS bill_year,
    CAST(substr(nota_date, 6, 2) AS INTEGER) AS bill_month,
    total_price,
    SUM(total_price) OVER (
      PARTITION BY customer_id, substr(nota_date, 1, 4), substr(nota_date, 6, 2)
      ORDER BY nota_date, nota_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS cum_before
  FROM nota
  WHERE is_void = 0
),
bill_paid AS (
  SELECT customer_id, bill_year, bill_month, SUM(amount) AS paid
  FROM payment
  WHERE is_void = 0
  GROUP BY customer_id, bill_year, bill_month
),
base AS (
  SELECT
    n.nota_id,
    n.nota_number,
    n.total_price,
    n.is_void,
    MAX(0, MIN(n.total_price, COALESCE(bp.paid, 0) - COALESCE(bn.cum_before, 0))) AS computed_paid
  FROM nota n
  LEFT JOIN bill_nota bn ON bn.nota_id = n.nota_id
  LEFT JOIN bill_paid bp ON bp.customer_id = bn.customer_id
    AND bp.bill_year = bn.bill_year AND bp.bill_month = bn.bill_month
)
SELECT
  nota_id,
  nota_number,
  total_price,
  CASE WHEN is_void = 1 THEN 0 ELSE computed_paid END AS paid_amount,
  CASE
    WHEN is_void = 1 THEN 'void'
    WHEN computed_paid >= total_price THEN 'paid'
    WHEN computed_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS status
FROM base;
