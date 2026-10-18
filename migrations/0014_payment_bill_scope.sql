-- Payment is scoped to the bill (customer + month), not a single nota.
-- A bill can cover several nota for the same customer/month, so a per-nota
-- FK forced an artificial split across rows for one real-world payment.
-- Replaced with customer_id + bill_year + bill_month directly on payment.
-- nota.paid_amount/status (nota_summary) becomes a live waterfall
-- allocation across the bill period instead of a stored per-nota sum.

ALTER TABLE payment ADD COLUMN customer_id INTEGER REFERENCES customer (customer_id);
ALTER TABLE payment ADD COLUMN bill_year INTEGER;
ALTER TABLE payment ADD COLUMN bill_month INTEGER;

UPDATE payment SET
  customer_id = (SELECT customer_id FROM nota WHERE nota.nota_id = payment.nota_id),
  bill_year = CAST(substr((SELECT nota_date FROM nota WHERE nota.nota_id = payment.nota_id), 1, 4) AS INTEGER),
  bill_month = CAST(substr((SELECT nota_date FROM nota WHERE nota.nota_id = payment.nota_id), 6, 2) AS INTEGER);

DROP VIEW nota_summary;

DROP INDEX IF EXISTS idx_payment_nota;
ALTER TABLE payment DROP COLUMN nota_id;

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
