-- user_id becomes a real UUID (TEXT) instead of an autoincrement integer.
-- Applies to USER_DB (user_accounts) only. Statements are independent and
-- safe to run one at a time (the D1 console chokes on a multi-statement
-- paste) -- order matters, run top to bottom.
--
-- Already applied by hand (2026-11-10):
--   user_id  username    user_uuid
--   1        lisacu      d8ae46f3-7592-457f-b024-112def649953
--   2        rudisalim   f9834959-8cbc-43f7-b589-e78c868ee12e
--   3        superadmin  f1f519da-24b5-4d53-b9f4-6463a1d5978c

ALTER TABLE user ADD COLUMN user_uuid TEXT;

UPDATE user SET user_uuid = (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
);

CREATE TABLE user_new (
  user_id       TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_new (user_id, username, name, password_hash, role, is_active, created_at)
SELECT user_uuid, username, name, password_hash, role, is_active, created_at FROM user;

DROP TABLE user;

ALTER TABLE user_new RENAME TO user;
