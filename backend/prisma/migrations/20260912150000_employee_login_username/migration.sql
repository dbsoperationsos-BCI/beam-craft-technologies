-- The login username of the account linked to each employee, mirrored from `user.username` - see
-- the note on `Employee.loginUsername` in schema.prisma for why this is a read copy rather than a
-- second place a username is decided.
ALTER TABLE `employee`
  ADD COLUMN `login_username` VARCHAR(50) NULL;

CREATE UNIQUE INDEX `employee_login_username_key` ON `employee` (`login_username`);

-- Backfill: every employee who already has an account gets its username copied across once, so
-- this column starts true rather than NULL for every row that existed before it. Every write from
-- here on keeps it true; this statement never runs again.
UPDATE `employee` AS `e`
  INNER JOIN `user` AS `u` ON `u`.`linked_employee_id` = `e`.`id`
  SET `e`.`login_username` = `u`.`username`
  WHERE `u`.`username` IS NOT NULL;
