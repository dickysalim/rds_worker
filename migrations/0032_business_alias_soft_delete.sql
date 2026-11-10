-- Lets an alias be "deleted" (deactivated) without breaking past nota that
-- reference its business_id. The primary business row is never deactivated.
ALTER TABLE business ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
