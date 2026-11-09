-- Contact person, phone number and address become optional on customer/nota:
-- only company_name is required when adding a nota. customer.contact_person/
-- phone_number were already nullable (0015); nota.contact_name_snapshot and
-- contact_phone_number_snapshot were still NOT NULL, so this rebuilds nota to
-- drop that constraint. trg_nota_void_restock targets this table and must be
-- dropped first and recreated after, per the 0019 caveat; nota_summary is a
-- view over nota and is dropped/recreated too.

DROP TRIGGER trg_nota_void_restock;
DROP VIEW nota_summary;

CREATE TABLE nota_new (
  nota_id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_number                    TEXT NOT NULL UNIQUE,
  nota_date                      TEXT NOT NULL,
  customer_id                    INTEGER NOT NULL,
  customer_company_name_snapshot TEXT NOT NULL,
  customer_address_snapshot      TEXT,
  contact_name_snapshot          TEXT,
  contact_phone_number_snapshot  TEXT,
  total_price                    INTEGER NOT NULL,
  created_by                     INTEGER NOT NULL,
  is_void                        INTEGER NOT NULL DEFAULT 0,
  created_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pdf_r2_key                     TEXT,
  notes                          TEXT
);

INSERT INTO nota_new (
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, created_by, is_void, created_at, pdf_r2_key, notes
)
SELECT
  nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot,
  customer_address_snapshot, contact_name_snapshot, contact_phone_number_snapshot,
  total_price, created_by, is_void, created_at, pdf_r2_key, notes
FROM nota;

DROP TABLE nota;
ALTER TABLE nota_new RENAME TO nota;

CREATE INDEX idx_nota_customer ON nota (customer_id);

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
