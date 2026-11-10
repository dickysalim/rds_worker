-- Replaces username (stock_ledger/product/customer) and old integer user_id
-- (nota.created_by) with the new UUIDs from 0028. Applies to DB and
-- DB_STAGING -- run on both. USER_DB can't be joined cross-database, so
-- this is a literal per-user backfill rather than a subquery.
--
-- Mapping used (from 0028):
--   lisacu     (user_id 1) -> d8ae46f3-7592-457f-b024-112def649953
--   rudisalim  (user_id 2) -> f9834959-8cbc-43f7-b589-e78c868ee12e
--   superadmin (user_id 3) -> f1f519da-24b5-4d53-b9f4-6463a1d5978c
--
-- Already applied by hand (2026-11-10) to both DB and DB_STAGING.

UPDATE stock_ledger SET created_by = 'd8ae46f3-7592-457f-b024-112def649953' WHERE created_by = 'lisacu';
UPDATE stock_ledger SET updated_by = 'd8ae46f3-7592-457f-b024-112def649953' WHERE updated_by = 'lisacu';
UPDATE stock_ledger SET created_by = 'f9834959-8cbc-43f7-b589-e78c868ee12e' WHERE created_by = 'rudisalim';
UPDATE stock_ledger SET updated_by = 'f9834959-8cbc-43f7-b589-e78c868ee12e' WHERE updated_by = 'rudisalim';
UPDATE stock_ledger SET created_by = 'f1f519da-24b5-4d53-b9f4-6463a1d5978c' WHERE created_by = 'superadmin';
UPDATE stock_ledger SET updated_by = 'f1f519da-24b5-4d53-b9f4-6463a1d5978c' WHERE updated_by = 'superadmin';

UPDATE product SET updated_by = 'd8ae46f3-7592-457f-b024-112def649953' WHERE updated_by = 'lisacu';
UPDATE product SET updated_by = 'f9834959-8cbc-43f7-b589-e78c868ee12e' WHERE updated_by = 'rudisalim';
UPDATE product SET updated_by = 'f1f519da-24b5-4d53-b9f4-6463a1d5978c' WHERE updated_by = 'superadmin';

UPDATE customer SET updated_by = 'd8ae46f3-7592-457f-b024-112def649953' WHERE updated_by = 'lisacu';
UPDATE customer SET updated_by = 'f9834959-8cbc-43f7-b589-e78c868ee12e' WHERE updated_by = 'rudisalim';
UPDATE customer SET updated_by = 'f1f519da-24b5-4d53-b9f4-6463a1d5978c' WHERE updated_by = 'superadmin';

-- nota.created_by stays declared INTEGER -- SQLite has no strict typing by
-- default, a TEXT UUID stores fine in that column.
UPDATE nota SET created_by = 'd8ae46f3-7592-457f-b024-112def649953' WHERE created_by = 1;
UPDATE nota SET created_by = 'f9834959-8cbc-43f7-b589-e78c868ee12e' WHERE created_by = 2;
UPDATE nota SET created_by = 'f1f519da-24b5-4d53-b9f4-6463a1d5978c' WHERE created_by = 3;
