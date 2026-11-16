-- Vendor + Purchase Order: same shape as customer/nota. vendor is one row
-- per vendor (updated in place, version trail in vendor_history), same as
-- the post-0034 customer table. purchase_order is a PO header only -- its
-- line items are just raw_material_ledger rows tagged with
-- purchase_order_id and movement_type = 'purchase_in' (no separate
-- purchase_order_item table: the ledger already is that record, same spirit
-- as nota_item being both the sale record and the stock debit).
--
-- Statements are independent and safe to run one at a time (the D1 console
-- chokes on a multi-statement paste) -- order matters, run top to bottom.

CREATE TABLE vendor (
  vendor_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name    TEXT NOT NULL,
  address        TEXT,
  contact_person TEXT,
  phone_number   TEXT,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_vendor_vendor_id ON vendor (vendor_id);
CREATE UNIQUE INDEX idx_vendor_name_active ON vendor (vendor_name) WHERE is_active = 1;
CREATE UNIQUE INDEX idx_vendor_phone_active ON vendor (phone_number) WHERE is_active = 1;

CREATE TABLE vendor_history (
  history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id      INTEGER NOT NULL,
  vendor_name    TEXT,
  address        TEXT,
  contact_person TEXT,
  phone_number   TEXT,
  is_active      INTEGER,
  action         TEXT NOT NULL,
  changed_by     TEXT,
  changed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vendor_history_vendor ON vendor_history (vendor_id);

CREATE TRIGGER trg_vendor_history_insert
AFTER INSERT ON vendor
BEGIN
  INSERT INTO vendor_history (vendor_id, vendor_name, address, contact_person, phone_number, is_active, action, changed_by, changed_at)
  VALUES (NEW.vendor_id, NEW.vendor_name, NEW.address, NEW.contact_person, NEW.phone_number, NEW.is_active, 'create', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_vendor_history_update
AFTER UPDATE ON vendor
BEGIN
  INSERT INTO vendor_history (vendor_id, vendor_name, address, contact_person, phone_number, is_active, action, changed_by, changed_at)
  VALUES (NEW.vendor_id, NEW.vendor_name, NEW.address, NEW.contact_person, NEW.phone_number, NEW.is_active, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;

CREATE TABLE purchase_order (
  po_id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number               TEXT NOT NULL UNIQUE,
  po_date                 TEXT NOT NULL,
  vendor_id               INTEGER NOT NULL,
  vendor_name_snapshot    TEXT NOT NULL,
  vendor_address_snapshot TEXT,
  contact_person_snapshot TEXT,
  phone_number_snapshot   TEXT,
  notes                   TEXT,
  created_by              TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by              TEXT,
  updated_at              TEXT
);

CREATE INDEX idx_purchase_order_vendor ON purchase_order (vendor_id);

CREATE TABLE purchase_order_history (
  history_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id                   INTEGER NOT NULL,
  po_number               TEXT,
  po_date                 TEXT,
  vendor_id               INTEGER,
  vendor_name_snapshot     TEXT,
  vendor_address_snapshot TEXT,
  contact_person_snapshot TEXT,
  phone_number_snapshot   TEXT,
  notes                   TEXT,
  action                  TEXT NOT NULL,
  changed_by              TEXT,
  changed_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_purchase_order_history_po ON purchase_order_history (po_id);

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
