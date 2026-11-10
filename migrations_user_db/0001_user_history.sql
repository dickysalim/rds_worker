-- user_accounts DB only (USER_DB binding). No migrations_dir is configured for
-- this binding in wrangler.jsonc, so this file is NOT picked up by
-- `wrangler d1 migrations apply`. Run it by hand:
--   wrangler d1 execute user_accounts --remote --file=migrations_user_db/0001_user_history.sql
--
-- Trigger-written audit history for the user table (name/role/password edits
-- via Team Settings). Statements are independent and safe to run one at a
-- time (the D1 console chokes on a multi-statement paste) -- order matters,
-- run top to bottom.

CREATE TABLE user_history (
  history_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               TEXT NOT NULL,
  username              TEXT,
  name                  TEXT,
  role                  TEXT,
  is_active             INTEGER,
  must_change_password  INTEGER,
  action                TEXT NOT NULL,
  changed_by            TEXT,
  changed_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_history_user ON user_history (user_id);

-- Password hashes are never written into history.

INSERT INTO user_history (user_id, username, name, role, is_active, must_change_password, action, changed_by, changed_at)
SELECT user_id, username, name, role, is_active, must_change_password, 'migration', COALESCE(updated_by, created_by), CURRENT_TIMESTAMP
FROM user;

CREATE TRIGGER trg_user_history_insert
AFTER INSERT ON user
BEGIN
  INSERT INTO user_history (user_id, username, name, role, is_active, must_change_password, action, changed_by, changed_at)
  VALUES (NEW.user_id, NEW.username, NEW.name, NEW.role, NEW.is_active, NEW.must_change_password, 'create', NEW.created_by, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_user_history_update
AFTER UPDATE ON user
BEGIN
  INSERT INTO user_history (user_id, username, name, role, is_active, must_change_password, action, changed_by, changed_at)
  VALUES (NEW.user_id, NEW.username, NEW.name, NEW.role, NEW.is_active, NEW.must_change_password, 'update', NEW.updated_by, CURRENT_TIMESTAMP);
END;
