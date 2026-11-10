-- user_accounts DB only (USER_DB binding). Run by hand:
--   wrangler d1 execute user_accounts --remote --file=migrations_user_db/0002_create_staging_admin.sql
--
-- Dev-phase staging_admin user: admin-equivalent role, hidden from Team
-- Settings (handleListUsers excludes role staging_admin), unmanageable via
-- the team UI (requireManageableUser also excludes it), and gets the
-- staging-DB toggle in Account Settings. Not in ASSIGNABLE_ROLES, so it
-- can't be created/edited through the UI -- insert directly here.
--
-- password_hash is bcrypt("Kodoxgilo123", 10).

INSERT INTO user (user_id, username, name, password_hash, role, is_active, must_change_password, created_by, updated_by, updated_at)
VALUES (
  'e482e82a-4f51-4ef4-b2b8-f6ae140df51c',
  'stagingadmin',
  'Special Admin',
  '$2b$10$f7eDGyRKjhGw4OjzBxFiG.fO4TBtVYfClhzKCR28KBNHyTah1xEeW',
  'staging_admin',
  1,
  0,
  NULL,
  NULL,
  CURRENT_TIMESTAMP
);
