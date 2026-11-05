-- Where a candidate is **from**, and where they are **now**.
--
-- The screening form asked for a **State** and a postal **Address**, and neither answered what the
-- studio actually needs to know about somebody it is considering: a state is too coarse to say
-- whether they can be on the floor on Saturday, and a full address is more than a studio should hold
-- about a person it has not hired. The form asks Native Place and Current Location instead.
--
-- Two nullable columns, added and nothing dropped. `state` and `address` stay on the table because
-- a linked Google Sheet and the CSV import still fill them for candidates who arrived that way, and
-- HR can still read and correct them on the record - what changed is what the *candidate* is asked.
-- Dropping them would throw away answers already collected, which is not what "the form no longer
-- asks" means.
--
-- Guarded so it can be replayed: `ADD COLUMN IF NOT EXISTS` is not available on this MySQL, so each
-- is added only where `information_schema` says it is missing. Cost: two nullable columns on one
-- table, no backfill, no lock worth naming.

SET @sql := IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
   WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'hrm_interview_candidate' AND `COLUMN_NAME` = 'native_place') = 0,
  'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `native_place` VARCHAR(191) NULL AFTER `state`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
   WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'hrm_interview_candidate' AND `COLUMN_NAME` = 'current_location') = 0,
  'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `current_location` VARCHAR(191) NULL AFTER `native_place`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
