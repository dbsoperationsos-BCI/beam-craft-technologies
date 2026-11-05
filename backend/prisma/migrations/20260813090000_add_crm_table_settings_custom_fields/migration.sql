-- Per-lead answers to the custom fields built in Table Settings, as one JSON object keyed
-- by SalesCrmDynamicColumn.key. One column rather than a column per field, so adding a
-- field stays a data change instead of an ALTER TABLE on a large table.
--
-- `customFields` is one of `CRM_LEAD_SQL_COLUMNS`, so `ensureCrmLeadColumnsNow` creates it at boot
-- as `TEXT NULL` on any database whose API has run. Added when absent, and widened to the
-- `LongText` the schema declares when the runtime got there first.
SET @has_customFields := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'customFields');
SET @long_customFields := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'customFields' AND data_type = 'longtext');
SET @sql_customFields := CASE
  WHEN @has_customFields = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `customFields` LONGTEXT NULL'
  WHEN @long_customFields = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `customFields` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_customFields FROM @sql_customFields;
EXECUTE stmt_customFields;
DEALLOCATE PREPARE stmt_customFields;

-- The dynamic column becomes a full form field: what control renders it, its placeholder,
-- whether it is required, and its choices when it is a dropdown, checkbox or radio group.
--
-- The table itself is created by `20260813080000_add_crm_dynamic_columns`; before that migration
-- existed this ALTER was the first thing a fresh database met, and it answered error 1146. Guarded
-- per column as well, because a database that reached this point outside the chain already has
-- them - the development database did.
SET @has_fieldType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmDynamicColumn' AND column_name = 'fieldType');
SET @sql_fieldType := IF(@has_fieldType = 0,
  'ALTER TABLE `SalesCrmDynamicColumn` ADD COLUMN `fieldType` VARCHAR(30) NOT NULL DEFAULT ''text''',
  'DO 0');
PREPARE stmt_fieldType FROM @sql_fieldType;
EXECUTE stmt_fieldType;
DEALLOCATE PREPARE stmt_fieldType;

SET @has_placeholder := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmDynamicColumn' AND column_name = 'placeholder');
SET @sql_placeholder := IF(@has_placeholder = 0,
  'ALTER TABLE `SalesCrmDynamicColumn` ADD COLUMN `placeholder` VARCHAR(191) NULL',
  'DO 0');
PREPARE stmt_placeholder FROM @sql_placeholder;
EXECUTE stmt_placeholder;
DEALLOCATE PREPARE stmt_placeholder;

SET @has_required := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmDynamicColumn' AND column_name = 'required');
SET @sql_required := IF(@has_required = 0,
  'ALTER TABLE `SalesCrmDynamicColumn` ADD COLUMN `required` BOOLEAN NOT NULL DEFAULT false',
  'DO 0');
PREPARE stmt_required FROM @sql_required;
EXECUTE stmt_required;
DEALLOCATE PREPARE stmt_required;

SET @has_options := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmDynamicColumn' AND column_name = 'options');
SET @sql_options := IF(@has_options = 0,
  'ALTER TABLE `SalesCrmDynamicColumn` ADD COLUMN `options` TEXT NULL',
  'DO 0');
PREPARE stmt_options FROM @sql_options;
EXECUTE stmt_options;
DEALLOCATE PREPARE stmt_options;
