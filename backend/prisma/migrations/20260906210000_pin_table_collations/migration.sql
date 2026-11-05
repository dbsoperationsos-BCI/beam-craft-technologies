-- Pin six tables to `utf8mb4_unicode_ci`, whatever the database they were built in defaults to.
--
-- Every CREATE TABLE in this folder ends `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
-- except six, in `20260904120000_referrals_tasks_and_quotation_link`, which end `);` and so take
-- whatever the *database* defaults to. On a developer's machine and on the VPS that is
-- `utf8mb4_unicode_ci` and the omission never showed. MySQL 8 defaults a new database to
-- `utf8mb4_0900_ai_ci`, so on a database created without saying - which is what CI's throwaway
-- container did - those six came out in a different collation from every other table.
--
-- Nothing failed until a query compared the two. `20260906160000_data_scope_backfill` joins
-- `hrm_task`.`branch` to `branch`.`name` to fill in the branch reference, and MySQL refuses to
-- compare two columns of different collations: "Illegal mix of collations
-- (utf8mb4_0900_ai_ci,IMPLICIT) and (utf8mb4_unicode_ci,IMPLICIT)". A join that works everywhere
-- the studio runs and fails on a fresh database is the worst shape a schema bug takes, because the
-- place it fails is the place that is supposed to catch it.
--
-- CI now creates its database as `utf8mb4_unicode_ci` before applying anything, which is the fix
-- that matters: this migration cannot help a from-scratch build, because it runs *after* the
-- backfill that fails. It is here for a database that has already drifted, and to stop the schema
-- depending on a server default it never states.
--
-- Conditional on purpose. `ALTER TABLE ... CONVERT TO CHARACTER SET` rewrites the whole table, and
-- on every database the studio actually runs these six are already correct - so each one is asked
-- about first and converted only if it differs. On a correct database this migration reads six rows
-- from `information_schema` and writes nothing.
--
-- The six migrations that created them are long since applied and are not edited; a migration
-- already in git is never rewritten.

-- `hrm_settings`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'hrm_settings' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `hrm_settings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `employee_referral`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'employee_referral' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `employee_referral` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `employee_referral_payout`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'employee_referral_payout' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `employee_referral_payout` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `hrm_task`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'hrm_task' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `hrm_task` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `hrm_task_activity`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'hrm_task_activity' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `hrm_task_activity` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `notification`
SET @needed := (SELECT COUNT(*) FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE() AND `table_name` = 'notification' AND `table_collation` <> 'utf8mb4_unicode_ci');
SET @sql := IF(@needed > 0,
  'ALTER TABLE `notification` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
