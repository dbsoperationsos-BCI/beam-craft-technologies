-- Changing a password now signs the account out of every device. A token carries no password and is
-- good for days, so the only way to end one already issued is to refuse it: the moment of the change
-- is stamped here, and `authMiddleware` refuses every token minted before it.
--
-- NULL on every existing row, which reads as "never changed" - so nobody signed in today is thrown
-- out by this migration. The column is written the next time each account's password is set.
ALTER TABLE `user` ADD COLUMN `password_changed_at` DATETIME(3) NULL;
