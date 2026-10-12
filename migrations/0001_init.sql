-- Nota app: single-tenant schema for Cloudflare D1 (SQLite)
-- Apply with: wrangler d1 migrations apply <DB_NAME>  (place in ./migrations/)

CREATE TABLE business (
  business_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name           TEXT NOT NULL,
  business_address        TEXT,
  business_contact_number TEXT,
  nota_counter            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer (
  customer_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  address      TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE customer_contact (
  contact_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customer (customer_id),
  contact_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE product (
  sku_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_name        TEXT NOT NULL,
  unit            TEXT NOT NULL,
  suggested_price INTEGER,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE nota (
  nota_id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_number                    TEXT NOT NULL UNIQUE,
  nota_date                      TEXT NOT NULL,  -- local date YYYY-MM-DD, set by backend
  customer_id                    INTEGER NOT NULL REFERENCES customer (customer_id),
  customer_company_name_snapshot TEXT NOT NULL,
  customer_address_snapshot      TEXT,
  contact_id                     INTEGER NOT NULL REFERENCES customer_contact (contact_id),
  contact_name_snapshot          TEXT NOT NULL,
  contact_phone_number_snapshot  TEXT NOT NULL,
  total_price                    INTEGER NOT NULL,
  created_by                     INTEGER NOT NULL REFERENCES user (user_id),
  is_void                        INTEGER NOT NULL DEFAULT 0,
  created_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nota_item (
  nota_item_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id            INTEGER NOT NULL REFERENCES nota (nota_id),
  sku_id             INTEGER NOT NULL REFERENCES product (sku_id),
  item_name_snapshot TEXT NOT NULL,
  unit_snapshot      TEXT NOT NULL,
  qty                REAL NOT NULL,
  price              INTEGER NOT NULL,
  discount_amount    INTEGER NOT NULL DEFAULT 0,
  total_price        INTEGER NOT NULL
);

CREATE TABLE payment (
  payment_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id      INTEGER NOT NULL REFERENCES nota (nota_id),
  payment_date TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  method       TEXT,
  reference    TEXT,
  is_void      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nota_customer  ON nota (customer_id);
CREATE INDEX idx_nota_date      ON nota (nota_date);
CREATE INDEX idx_nota_item_nota ON nota_item (nota_id);
CREATE INDEX idx_payment_nota   ON payment (nota_id);

-- paid_amount and status are computed, not stored
CREATE VIEW nota_summary AS
SELECT n.nota_id,
       n.nota_number,
       n.total_price,
       COALESCE(SUM(p.amount), 0) AS paid_amount,
       CASE
         WHEN n.is_void = 1 THEN 'void'
         WHEN COALESCE(SUM(p.amount), 0) = 0 THEN 'unpaid'
         WHEN COALESCE(SUM(p.amount), 0) < n.total_price THEN 'partial'
         ELSE 'paid'
       END AS status
FROM nota n
LEFT JOIN payment p ON p.nota_id = n.nota_id AND p.is_void = 0
GROUP BY n.nota_id;
