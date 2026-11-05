-- The bcrypt hashes of the passwords a login has had before its current one, newest first, so a
-- password change can refuse one used before. Nullable: an account that has never changed its
-- password has no history, and existing rows need no backfill.
ALTER TABLE `user` ADD COLUMN `password_history` JSON NULL;
