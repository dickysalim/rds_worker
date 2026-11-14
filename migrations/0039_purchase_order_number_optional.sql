-- The "Add Raw Material" panel no longer collects a PO number (it had
-- nowhere real to flow yet, ahead of the Purchase Order module) -- make
-- po_number nullable so creating a PO header doesn't need one.
--
-- Statements are independent and safe to run one at a time -- order matters,
-- run top to bottom.

CREATE TABLE purchase_order_new (
  po_id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number               TEXT,
  po_date                 TEXT NOT NULL,
  vendor_id               INTEGER,
  vendor_name_snapshot    TEXT,
  vendor_address_snapshot TEXT,
  contact_person_snapshot TEXT,
  phone_number_snapshot   TEXT,
  notes                   TEXT,
  created_by              TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by              TEXT,
  updated_at              TEXT
);

INSERT INTO purchase_order_new (
  po_id, po_number, po_date, vendor_id, vendor_name_snapshot, vendor_address_snapshot,
  contact_person_snapshot, phone_number_snapshot, notes, created_by, created_at, updated_by, updated_at
)
SELECT
  po_id, po_number, po_date, vendor_id, vendor_name_snapshot, vendor_address_snapshot,
  contact_person_snapshot, phone_number_snapshot, notes, created_by, created_at, updated_by, updated_at
FROM purchase_order;

DROP TABLE purchase_order;

ALTER TABLE purchase_order_new RENAME TO purchase_order;

CREATE INDEX idx_purchase_order_vendor ON purchase_order (vendor_id);

CREATE TRIGGER trg_purchase_order_history_insert
AFTER INSERT ON purchase_order
BEGIN
  INSERT INTO purchase_order_history (po_id, po_number, po_date, vendor_id, vendor_name_snapshot, vendor_address_snapshot, contact_person_snapshot, phone_number_snapshot, notes, action, changed_by, changed_at)
  VALUES (NEW.po_id, NEW.po_number, NEW.po_date, NEW.vendor_id, NEW.vendor_name_snapshot, NEW.vendor_address_snapshot, NEW.contact_person_snapshot, NEW.phone_number_snapshot, NEW.notes, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_purchase_order_history_update
AFTER UPDATE ON purchase_order
BEGIN
  INSERT INTO purchase_order_history (po_id, po_number, po_date, vendor_id, vendor_name_snapshot, vendor_address_snapshot, contact_person_snapshot, phone_number_snapshot, notes, action, changed_by, changed_at)
  VALUES (NEW.po_id, NEW.po_number, NEW.po_date, NEW.vendor_id, NEW.vendor_name_snapshot, NEW.vendor_address_snapshot, NEW.contact_person_snapshot, NEW.phone_number_snapshot, NEW.notes, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;
