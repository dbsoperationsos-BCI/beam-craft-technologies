-- Popup fields that previously had nowhere to persist: the follow-up time, the
-- Event Details rows and the remark history, stored as JSON text. `attachments`
-- is included because it was only ever created by a runtime ALTER TABLE and is
-- otherwise missing on a fresh clone.
--
-- Every one of these columns is also created at boot by `ensureCrmLeadColumnsNow`
-- (crm-leads/crmLeadService.js), which adds each of `CRM_LEAD_SQL_COLUMNS` as `TEXT NULL` when
-- it is missing. So on any database whose API has served traffic the columns are already there,
-- and a plain ADD COLUMN answered error 1060, duplicate column - which is where `migrate deploy`
-- stopped on production.
--
-- Each column is therefore added when absent and corrected when present. The correction matters:
-- the runtime creates them as `TEXT`, which caps at 64 KB, while `schema.prisma` declares
-- `shoots`, `remarkEntries` and `attachments` as `LongText`. Left as `TEXT` a lead with a long
-- remark history or a few attachments would be truncated on write, and the database would not
-- match the schema. `nextFollowUpTime` is `Text` in the schema, so for that one the runtime's type
-- is already right and only the guard is needed.

-- nextFollowUpTime: TEXT, matching @db.Text.
SET @has_nextFollowUpTime := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'nextFollowUpTime');
SET @sql_nextFollowUpTime := IF(@has_nextFollowUpTime = 0,
  'ALTER TABLE `SalesCrmLead` ADD COLUMN `nextFollowUpTime` TEXT NULL',
  'DO 0');
PREPARE stmt_nextFollowUpTime FROM @sql_nextFollowUpTime;
EXECUTE stmt_nextFollowUpTime;
DEALLOCATE PREPARE stmt_nextFollowUpTime;

-- shoots: LONGTEXT, matching @db.LongText.
SET @has_shoots := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shoots');
SET @long_shoots := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shoots' AND data_type = 'longtext');
SET @sql_shoots := CASE
  WHEN @has_shoots = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `shoots` LONGTEXT NULL'
  WHEN @long_shoots = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `shoots` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_shoots FROM @sql_shoots;
EXECUTE stmt_shoots;
DEALLOCATE PREPARE stmt_shoots;

-- remarkEntries: LONGTEXT, matching @db.LongText.
SET @has_remarkEntries := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarkEntries');
SET @long_remarkEntries := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarkEntries' AND data_type = 'longtext');
SET @sql_remarkEntries := CASE
  WHEN @has_remarkEntries = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `remarkEntries` LONGTEXT NULL'
  WHEN @long_remarkEntries = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `remarkEntries` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_remarkEntries FROM @sql_remarkEntries;
EXECUTE stmt_remarkEntries;
DEALLOCATE PREPARE stmt_remarkEntries;

-- attachments: LONGTEXT, matching @db.LongText.
SET @has_attachments := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'attachments');
SET @long_attachments := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'attachments' AND data_type = 'longtext');
SET @sql_attachments := CASE
  WHEN @has_attachments = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `attachments` LONGTEXT NULL'
  WHEN @long_attachments = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `attachments` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_attachments FROM @sql_attachments;
EXECUTE stmt_attachments;
DEALLOCATE PREPARE stmt_attachments;
