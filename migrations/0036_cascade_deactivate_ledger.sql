-- Soft-deleting a product/raw material (is_active 1 -> 0) now cascades to
-- every still-active ledger row for it, so a deleted item's movement history
-- stops showing up in Stock Management / Raw Mat. Management. One-way only
-- (there is no undelete flow for product/raw_material in this app, so no
-- reverse cascade is needed). updated_by is carried over from the deleting
-- user (NEW.updated_by on the product/raw_material row), so the ledger rows'
-- own audit trail correctly records who triggered the deactivation.
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

CREATE TRIGGER trg_product_deactivate_cascade
AFTER UPDATE OF is_active ON product
WHEN NEW.is_active = 0 AND OLD.is_active = 1
BEGIN
  UPDATE stock_ledger
  SET is_active = 0, updated_by = NEW.updated_by, updated_at = CURRENT_TIMESTAMP
  WHERE sku_id = NEW.sku_id AND is_active = 1;
END;

CREATE TRIGGER trg_raw_material_deactivate_cascade
AFTER UPDATE OF is_active ON raw_material
WHEN NEW.is_active = 0 AND OLD.is_active = 1
BEGIN
  UPDATE raw_material_ledger
  SET is_active = 0, updated_by = NEW.updated_by, updated_at = CURRENT_TIMESTAMP
  WHERE raw_mat_id = NEW.raw_mat_id AND is_active = 1;
END;
