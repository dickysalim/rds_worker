-- Purchase order linkage/auto-numbering isn't built yet -- store the PO
-- reference the user types as plain text per ledger row instead of via
-- purchase_order_id, until the real Purchase Order module exists.
--
-- Statements are independent and safe to run one at a time -- order matters,
-- run top to bottom.

ALTER TABLE raw_material_ledger ADD COLUMN purchase_order_freetext TEXT;

ALTER TABLE raw_material_ledger_history ADD COLUMN purchase_order_freetext TEXT;

DROP TRIGGER trg_raw_material_ledger_history_insert;

DROP TRIGGER trg_raw_material_ledger_history_update;

CREATE TRIGGER trg_raw_material_ledger_history_insert
AFTER INSERT ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, purchase_order_freetext, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.purchase_order_freetext, NEW.price, NEW.is_active, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_raw_material_ledger_history_update
AFTER UPDATE ON raw_material_ledger
BEGIN
  INSERT INTO raw_material_ledger_history (id, raw_mat_id, date, movement_type, qty, note, purchase_order_id, purchase_order_freetext, price, is_active, action, changed_by, changed_at)
  VALUES (NEW.id, NEW.raw_mat_id, NEW.date, NEW.movement_type, NEW.qty, NEW.note, NEW.purchase_order_id, NEW.purchase_order_freetext, NEW.price, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;
