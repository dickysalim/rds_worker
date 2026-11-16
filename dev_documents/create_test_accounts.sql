-- Creates testowner / repurposes existing testadmin on USER_DB
-- (user_accounts) -- the shared auth DB used by both prod and staging.
-- Their role alone (test_owner/test_admin) is what forces every DB-backed
-- request onto DB_STAGING server-side (src/index.ts), so these accounts can
-- never reach the real database regardless of which environment they log
-- in through. must_change_password = 0 -- password below is final, not
-- temporary.
--
-- testadmin (user_id 4a5c174b-9be1-4bae-9f46-eaeecb95aff4) already existed
-- as a real 'admin' account -- repurposed in place instead of inserted.
--
-- Statements are independent; run one at a time (D1 console chokes on a
-- multi-statement paste).

UPDATE user
SET name = 'Test Admin',
    password_hash = '$2b$10$TPyk34q2fJw.O1sbK.OtBOhwvDMv5N4Rcnyd1W1wQWT8mWmhq4/7C',
    role = 'test_admin',
    must_change_password = 0,
    is_active = 1
WHERE user_id = '4a5c174b-9be1-4bae-9f46-eaeecb95aff4' AND username = 'testadmin';

INSERT INTO user (user_id, username, name, password_hash, role, is_active, must_change_password)
VALUES (
  '1d89d0a1-ba28-4a63-9b1a-ca83b3a62df1',
  'testowner',
  'Test Owner',
  '$2b$10$TPyk34q2fJw.O1sbK.OtBOhwvDMv5N4Rcnyd1W1wQWT8mWmhq4/7C',
  'test_owner',
  1,
  0
);
