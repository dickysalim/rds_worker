-- Team Settings: super_admin can list/create non-super_admin users.
-- A freshly created user gets a random 8-digit numeric password and must
-- change it on first login. Applies to USER_DB (user_accounts) only.

ALTER TABLE user ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
