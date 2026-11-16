-- Staging-only reset: wipes all raw material data and history so testing can
-- start from an empty slate. No FKs enforced in this schema, so plain
-- DELETEs are safe in any order; included in a sensible order anyway.
-- Resets AUTOINCREMENT counters too, so new raw materials start at ID 1 again.

DELETE FROM raw_material_ledger_history;
DELETE FROM raw_material_history;
DELETE FROM raw_material_ledger;
DELETE FROM raw_material_stock;
DELETE FROM raw_material;

DELETE FROM sqlite_sequence WHERE name IN ('raw_material_ledger_history', 'raw_material_history', 'raw_material_ledger', 'raw_material');
