-- An employee leaving now serves their notice before their status changes: `relieved_at` is when the
-- separation's status was put on them and their login closed, null while they still work.
ALTER TABLE `employee_separation` ADD COLUMN `relieved_at` DATETIME(3) NULL;

-- Every separation recorded before this was relieved the moment it was saved.
UPDATE `employee_separation` SET `relieved_at` = `created_at` WHERE `relieved_at` IS NULL;
