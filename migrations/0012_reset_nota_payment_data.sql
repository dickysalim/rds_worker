-- One-off data reset for the Prototype Overview rework: clears mock nota/payment
-- records so fresh seed data can be generated via the API. Customers and products
-- are kept intact. Not a schema change; run once, then discard.
DELETE FROM payment;
DELETE FROM nota_item;
DELETE FROM nota;
DELETE FROM sqlite_sequence WHERE name IN ('nota', 'nota_item', 'payment');
