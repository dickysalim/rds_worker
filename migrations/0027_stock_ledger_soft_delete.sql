-- Stock ledger entries become editable and soft-deletable (is_active flag --
-- "delete" just flips it to 0, never actually removes the row), with an
-- audit trail of who last touched it. Plain ADD COLUMN, no rebuild needed --
-- stock_ledger carries no CHECK on these columns and no trigger targets it.
ALTER TABLE stock_ledger ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stock_ledger ADD COLUMN updated_by TEXT;
ALTER TABLE stock_ledger ADD COLUMN updated_at TEXT;
