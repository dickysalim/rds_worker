-- Backfills payment_number for rows created before migration 0008 added the column
-- (and any rows inserted directly, bypassing the API). Mirrors the live format
-- PAY/<yymm>/<customer_id>-<seq within nota>/<global seq>, numbered by payment_id order.
-- Note: the global seq here is scoped to the backfilled rows only (restarts at 1),
-- so it may repeat a seq already used by a payment that already had a number -
-- cosmetic only, not used as a uniqueness key anywhere.
WITH ordered AS (
  SELECT
    p.payment_id,
    'PAY/' || substr(p.payment_date, 3, 2) || substr(p.payment_date, 6, 2) || '/' ||
      n.customer_id || '-' ||
      ROW_NUMBER() OVER (PARTITION BY p.nota_id ORDER BY p.payment_id) || '/' ||
      ROW_NUMBER() OVER (ORDER BY p.payment_id) AS computed_number
  FROM payment p
  JOIN nota n ON n.nota_id = p.nota_id
  WHERE p.payment_number IS NULL
)
UPDATE payment
SET payment_number = (SELECT computed_number FROM ordered WHERE ordered.payment_id = payment.payment_id)
WHERE payment_id IN (SELECT payment_id FROM ordered);
