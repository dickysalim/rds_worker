-- Track who created/last edited a user account (super_admin acting via
-- Team Settings). Applies to USER_DB (user_accounts) only. Plain ADD COLUMN,
-- no rebuild needed -- user carries no CHECK on these and no trigger targets it.
ALTER TABLE user ADD COLUMN created_by TEXT;
ALTER TABLE user ADD COLUMN updated_by TEXT;
ALTER TABLE user ADD COLUMN updated_at TEXT;
