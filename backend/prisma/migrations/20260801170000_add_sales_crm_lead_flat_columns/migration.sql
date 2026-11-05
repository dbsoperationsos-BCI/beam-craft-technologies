-- The CRM lead table as `schema.prisma` declares it.
--
-- `SalesCrmLead` was created by `20260801160000_add_sales_crm_leads` as two JSON blobs,
-- `leadJson` and `detailsJson`. The flat columns that replaced them were never added by a
-- migration: `ensureCrmLeadColumnsNow` (crm-leads/crmLeadService.js) adds each of
-- `CRM_LEAD_SQL_COLUMNS` as `TEXT NULL` at boot, so they only ever existed on a database whose
-- API had run. That left the chain and the schema disagreeing about the same table, and it is why
-- `20260815160000_add_crm_vertical_views` stopped a fresh database with error 1054, unknown column
-- `date`: the view selects flat columns that no migration had created.
--
-- Every column is added when absent, so this is a no-op on a database the runtime got to first, and
-- corrected when present but of the wrong type - the runtime creates everything as `TEXT`, while
-- the schema declares `shoots`, `remarkEntries`, `attachments` and `customFields` as
-- `LongText`. `TEXT` caps at 64 KB, so a lead with a long remark history or several attachments
-- was being truncated on write. Nothing is dropped and no value is rewritten.


SET @has_name := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'name');
SET @type_name := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'name' AND data_type = 'text');
SET @sql_name := CASE
  WHEN @has_name = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `name` TEXT NULL'
  WHEN @type_name = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `name` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_name FROM @sql_name;
EXECUTE stmt_name;
DEALLOCATE PREPARE stmt_name;

SET @has_phone := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'phone');
SET @type_phone := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'phone' AND data_type = 'text');
SET @sql_phone := CASE
  WHEN @has_phone = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `phone` TEXT NULL'
  WHEN @type_phone = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `phone` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_phone FROM @sql_phone;
EXECUTE stmt_phone;
DEALLOCATE PREPARE stmt_phone;

SET @has_branch := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'branch');
SET @type_branch := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'branch' AND data_type = 'text');
SET @sql_branch := CASE
  WHEN @has_branch = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `branch` TEXT NULL'
  WHEN @type_branch = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `branch` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_branch FROM @sql_branch;
EXECUTE stmt_branch;
DEALLOCATE PREPARE stmt_branch;

SET @has_status := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'status');
SET @type_status := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'status' AND data_type = 'text');
SET @sql_status := CASE
  WHEN @has_status = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `status` TEXT NULL'
  WHEN @type_status = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `status` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_status FROM @sql_status;
EXECUTE stmt_status;
DEALLOCATE PREPARE stmt_status;

SET @has_crm := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'crm');
SET @type_crm := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'crm' AND data_type = 'text');
SET @sql_crm := CASE
  WHEN @has_crm = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `crm` TEXT NULL'
  WHEN @type_crm = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `crm` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_crm FROM @sql_crm;
EXECUTE stmt_crm;
DEALLOCATE PREPARE stmt_crm;

SET @has_addedTime := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'addedTime');
SET @type_addedTime := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'addedTime' AND data_type = 'text');
SET @sql_addedTime := CASE
  WHEN @has_addedTime = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `addedTime` TEXT NULL'
  WHEN @type_addedTime = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `addedTime` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_addedTime FROM @sql_addedTime;
EXECUTE stmt_addedTime;
DEALLOCATE PREPARE stmt_addedTime;

SET @has_createdDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'createdDate');
SET @type_createdDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'createdDate' AND data_type = 'text');
SET @sql_createdDate := CASE
  WHEN @has_createdDate = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `createdDate` TEXT NULL'
  WHEN @type_createdDate = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `createdDate` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_createdDate FROM @sql_createdDate;
EXECUTE stmt_createdDate;
DEALLOCATE PREPARE stmt_createdDate;

SET @has_relationship := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'relationship');
SET @type_relationship := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'relationship' AND data_type = 'text');
SET @sql_relationship := CASE
  WHEN @has_relationship = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `relationship` TEXT NULL'
  WHEN @type_relationship = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `relationship` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_relationship FROM @sql_relationship;
EXECUTE stmt_relationship;
DEALLOCATE PREPARE stmt_relationship;

SET @has_referredFrom := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referredFrom');
SET @type_referredFrom := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referredFrom' AND data_type = 'text');
SET @sql_referredFrom := CASE
  WHEN @has_referredFrom = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `referredFrom` TEXT NULL'
  WHEN @type_referredFrom = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `referredFrom` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_referredFrom FROM @sql_referredFrom;
EXECUTE stmt_referredFrom;
DEALLOCATE PREPARE stmt_referredFrom;

SET @has_offerType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'offerType');
SET @type_offerType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'offerType' AND data_type = 'text');
SET @sql_offerType := CASE
  WHEN @has_offerType = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `offerType` TEXT NULL'
  WHEN @type_offerType = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `offerType` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_offerType FROM @sql_offerType;
EXECUTE stmt_offerType;
DEALLOCATE PREPARE stmt_offerType;

SET @has_campaignName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'campaignName');
SET @type_campaignName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'campaignName' AND data_type = 'text');
SET @sql_campaignName := CASE
  WHEN @has_campaignName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `campaignName` TEXT NULL'
  WHEN @type_campaignName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `campaignName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_campaignName FROM @sql_campaignName;
EXECUTE stmt_campaignName;
DEALLOCATE PREPARE stmt_campaignName;

SET @has_adsetName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'adsetName');
SET @type_adsetName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'adsetName' AND data_type = 'text');
SET @sql_adsetName := CASE
  WHEN @has_adsetName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `adsetName` TEXT NULL'
  WHEN @type_adsetName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `adsetName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_adsetName FROM @sql_adsetName;
EXECUTE stmt_adsetName;
DEALLOCATE PREPARE stmt_adsetName;

SET @has_adName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'adName');
SET @type_adName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'adName' AND data_type = 'text');
SET @sql_adName := CASE
  WHEN @has_adName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `adName` TEXT NULL'
  WHEN @type_adName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `adName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_adName FROM @sql_adName;
EXECUTE stmt_adName;
DEALLOCATE PREPARE stmt_adName;

SET @has_preferredBudget := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'preferredBudget');
SET @type_preferredBudget := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'preferredBudget' AND data_type = 'text');
SET @sql_preferredBudget := CASE
  WHEN @has_preferredBudget = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `preferredBudget` TEXT NULL'
  WHEN @type_preferredBudget = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `preferredBudget` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_preferredBudget FROM @sql_preferredBudget;
EXECUTE stmt_preferredBudget;
DEALLOCATE PREPARE stmt_preferredBudget;

SET @has_city := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'city');
SET @type_city := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'city' AND data_type = 'text');
SET @sql_city := CASE
  WHEN @has_city = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `city` TEXT NULL'
  WHEN @type_city = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `city` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_city FROM @sql_city;
EXECUTE stmt_city;
DEALLOCATE PREPARE stmt_city;

SET @has_state := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'state');
SET @type_state := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'state' AND data_type = 'text');
SET @sql_state := CASE
  WHEN @has_state = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `state` TEXT NULL'
  WHEN @type_state = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `state` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_state FROM @sql_state;
EXECUTE stmt_state;
DEALLOCATE PREPARE stmt_state;

SET @has_source := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'source');
SET @type_source := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'source' AND data_type = 'text');
SET @sql_source := CASE
  WHEN @has_source = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `source` TEXT NULL'
  WHEN @type_source = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `source` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_source FROM @sql_source;
EXECUTE stmt_source;
DEALLOCATE PREPARE stmt_source;

SET @has_assignedBranch := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'assignedBranch');
SET @type_assignedBranch := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'assignedBranch' AND data_type = 'text');
SET @sql_assignedBranch := CASE
  WHEN @has_assignedBranch = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `assignedBranch` TEXT NULL'
  WHEN @type_assignedBranch = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `assignedBranch` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_assignedBranch FROM @sql_assignedBranch;
EXECUTE stmt_assignedBranch;
DEALLOCATE PREPARE stmt_assignedBranch;

SET @has_eventPlannedType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'eventPlannedType');
SET @type_eventPlannedType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'eventPlannedType' AND data_type = 'text');
SET @sql_eventPlannedType := CASE
  WHEN @has_eventPlannedType = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `eventPlannedType` TEXT NULL'
  WHEN @type_eventPlannedType = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `eventPlannedType` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_eventPlannedType FROM @sql_eventPlannedType;
EXECUTE stmt_eventPlannedType;
DEALLOCATE PREPARE stmt_eventPlannedType;

SET @has_eventPlannedDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'eventPlannedDate');
SET @type_eventPlannedDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'eventPlannedDate' AND data_type = 'text');
SET @sql_eventPlannedDate := CASE
  WHEN @has_eventPlannedDate = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `eventPlannedDate` TEXT NULL'
  WHEN @type_eventPlannedDate = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `eventPlannedDate` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_eventPlannedDate FROM @sql_eventPlannedDate;
EXECUTE stmt_eventPlannedDate;
DEALLOCATE PREPARE stmt_eventPlannedDate;

SET @has_groomName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomName');
SET @type_groomName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomName' AND data_type = 'text');
SET @sql_groomName := CASE
  WHEN @has_groomName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `groomName` TEXT NULL'
  WHEN @type_groomName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `groomName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_groomName FROM @sql_groomName;
EXECUTE stmt_groomName;
DEALLOCATE PREPARE stmt_groomName;

SET @has_groomContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomContact');
SET @type_groomContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomContact' AND data_type = 'text');
SET @sql_groomContact := CASE
  WHEN @has_groomContact = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `groomContact` TEXT NULL'
  WHEN @type_groomContact = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `groomContact` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_groomContact FROM @sql_groomContact;
EXECUTE stmt_groomContact;
DEALLOCATE PREPARE stmt_groomContact;

SET @has_groomLocation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomLocation');
SET @type_groomLocation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'groomLocation' AND data_type = 'text');
SET @sql_groomLocation := CASE
  WHEN @has_groomLocation = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `groomLocation` TEXT NULL'
  WHEN @type_groomLocation = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `groomLocation` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_groomLocation FROM @sql_groomLocation;
EXECUTE stmt_groomLocation;
DEALLOCATE PREPARE stmt_groomLocation;

SET @has_brideName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideName');
SET @type_brideName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideName' AND data_type = 'text');
SET @sql_brideName := CASE
  WHEN @has_brideName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `brideName` TEXT NULL'
  WHEN @type_brideName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `brideName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_brideName FROM @sql_brideName;
EXECUTE stmt_brideName;
DEALLOCATE PREPARE stmt_brideName;

SET @has_brideContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideContact');
SET @type_brideContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideContact' AND data_type = 'text');
SET @sql_brideContact := CASE
  WHEN @has_brideContact = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `brideContact` TEXT NULL'
  WHEN @type_brideContact = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `brideContact` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_brideContact FROM @sql_brideContact;
EXECUTE stmt_brideContact;
DEALLOCATE PREPARE stmt_brideContact;

SET @has_brideLocation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideLocation');
SET @type_brideLocation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'brideLocation' AND data_type = 'text');
SET @sql_brideLocation := CASE
  WHEN @has_brideLocation = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `brideLocation` TEXT NULL'
  WHEN @type_brideLocation = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `brideLocation` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_brideLocation FROM @sql_brideLocation;
EXECUTE stmt_brideLocation;
DEALLOCATE PREPARE stmt_brideLocation;

SET @has_referenceName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referenceName');
SET @type_referenceName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referenceName' AND data_type = 'text');
SET @sql_referenceName := CASE
  WHEN @has_referenceName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `referenceName` TEXT NULL'
  WHEN @type_referenceName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `referenceName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_referenceName FROM @sql_referenceName;
EXECUTE stmt_referenceName;
DEALLOCATE PREPARE stmt_referenceName;

SET @has_referenceContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referenceContact');
SET @type_referenceContact := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'referenceContact' AND data_type = 'text');
SET @sql_referenceContact := CASE
  WHEN @has_referenceContact = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `referenceContact` TEXT NULL'
  WHEN @type_referenceContact = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `referenceContact` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_referenceContact FROM @sql_referenceContact;
EXECUTE stmt_referenceContact;
DEALLOCATE PREPARE stmt_referenceContact;

SET @has_remarks := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarks');
SET @type_remarks := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarks' AND data_type = 'text');
SET @sql_remarks := CASE
  WHEN @has_remarks = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `remarks` TEXT NULL'
  WHEN @type_remarks = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `remarks` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_remarks FROM @sql_remarks;
EXECUTE stmt_remarks;
DEALLOCATE PREPARE stmt_remarks;

SET @has_contactRepeated := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'contactRepeated');
SET @type_contactRepeated := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'contactRepeated' AND data_type = 'text');
SET @sql_contactRepeated := CASE
  WHEN @has_contactRepeated = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `contactRepeated` TEXT NULL'
  WHEN @type_contactRepeated = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `contactRepeated` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_contactRepeated FROM @sql_contactRepeated;
EXECUTE stmt_contactRepeated;
DEALLOCATE PREPARE stmt_contactRepeated;

SET @has_shootType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootType');
SET @type_shootType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootType' AND data_type = 'text');
SET @sql_shootType := CASE
  WHEN @has_shootType = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `shootType` TEXT NULL'
  WHEN @type_shootType = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `shootType` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_shootType FROM @sql_shootType;
EXECUTE stmt_shootType;
DEALLOCATE PREPARE stmt_shootType;

SET @has_location := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'location');
SET @type_location := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'location' AND data_type = 'text');
SET @sql_location := CASE
  WHEN @has_location = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `location` TEXT NULL'
  WHEN @type_location = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `location` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_location FROM @sql_location;
EXECUTE stmt_location;
DEALLOCATE PREPARE stmt_location;

SET @has_ihOh := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'ihOh');
SET @type_ihOh := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'ihOh' AND data_type = 'text');
SET @sql_ihOh := CASE
  WHEN @has_ihOh = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `ihOh` TEXT NULL'
  WHEN @type_ihOh = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `ihOh` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_ihOh FROM @sql_ihOh;
EXECUTE stmt_ihOh;
DEALLOCATE PREPARE stmt_ihOh;

SET @has_lastFollowUpDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastFollowUpDate');
SET @type_lastFollowUpDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastFollowUpDate' AND data_type = 'text');
SET @sql_lastFollowUpDate := CASE
  WHEN @has_lastFollowUpDate = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `lastFollowUpDate` TEXT NULL'
  WHEN @type_lastFollowUpDate = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `lastFollowUpDate` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_lastFollowUpDate FROM @sql_lastFollowUpDate;
EXECUTE stmt_lastFollowUpDate;
DEALLOCATE PREPARE stmt_lastFollowUpDate;

SET @has_nextFollowUpDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'nextFollowUpDate');
SET @type_nextFollowUpDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'nextFollowUpDate' AND data_type = 'text');
SET @sql_nextFollowUpDate := CASE
  WHEN @has_nextFollowUpDate = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `nextFollowUpDate` TEXT NULL'
  WHEN @type_nextFollowUpDate = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `nextFollowUpDate` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_nextFollowUpDate FROM @sql_nextFollowUpDate;
EXECUTE stmt_nextFollowUpDate;
DEALLOCATE PREPARE stmt_nextFollowUpDate;

SET @has_lastConvertedDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastConvertedDate');
SET @type_lastConvertedDate := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastConvertedDate' AND data_type = 'text');
SET @sql_lastConvertedDate := CASE
  WHEN @has_lastConvertedDate = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `lastConvertedDate` TEXT NULL'
  WHEN @type_lastConvertedDate = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `lastConvertedDate` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_lastConvertedDate FROM @sql_lastConvertedDate;
EXECUTE stmt_lastConvertedDate;
DEALLOCATE PREPARE stmt_lastConvertedDate;

SET @has_cnaSequence := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'cnaSequence');
SET @type_cnaSequence := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'cnaSequence' AND data_type = 'text');
SET @sql_cnaSequence := CASE
  WHEN @has_cnaSequence = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `cnaSequence` TEXT NULL'
  WHEN @type_cnaSequence = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `cnaSequence` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_cnaSequence FROM @sql_cnaSequence;
EXECUTE stmt_cnaSequence;
DEALLOCATE PREPARE stmt_cnaSequence;

SET @has_shootId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootId');
SET @type_shootId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootId' AND data_type = 'text');
SET @sql_shootId := CASE
  WHEN @has_shootId = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `shootId` TEXT NULL'
  WHEN @type_shootId = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `shootId` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_shootId FROM @sql_shootId;
EXECUTE stmt_shootId;
DEALLOCATE PREPARE stmt_shootId;

SET @has_date := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'date');
SET @type_date := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'date' AND data_type = 'text');
SET @sql_date := CASE
  WHEN @has_date = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `date` TEXT NULL'
  WHEN @type_date = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `date` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_date FROM @sql_date;
EXECUTE stmt_date;
DEALLOCATE PREPARE stmt_date;

SET @has_babyOrMotherName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'babyOrMotherName');
SET @type_babyOrMotherName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'babyOrMotherName' AND data_type = 'text');
SET @sql_babyOrMotherName := CASE
  WHEN @has_babyOrMotherName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `babyOrMotherName` TEXT NULL'
  WHEN @type_babyOrMotherName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `babyOrMotherName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_babyOrMotherName FROM @sql_babyOrMotherName;
EXECUTE stmt_babyOrMotherName;
DEALLOCATE PREPARE stmt_babyOrMotherName;

SET @has_dateOfBirthOrEdod := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'dateOfBirthOrEdod');
SET @type_dateOfBirthOrEdod := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'dateOfBirthOrEdod' AND data_type = 'text');
SET @sql_dateOfBirthOrEdod := CASE
  WHEN @has_dateOfBirthOrEdod = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `dateOfBirthOrEdod` TEXT NULL'
  WHEN @type_dateOfBirthOrEdod = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `dateOfBirthOrEdod` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_dateOfBirthOrEdod FROM @sql_dateOfBirthOrEdod;
EXECUTE stmt_dateOfBirthOrEdod;
DEALLOCATE PREPARE stmt_dateOfBirthOrEdod;

SET @has_companyName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyName');
SET @type_companyName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyName' AND data_type = 'text');
SET @sql_companyName := CASE
  WHEN @has_companyName = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `companyName` TEXT NULL'
  WHEN @type_companyName = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `companyName` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_companyName FROM @sql_companyName;
EXECUTE stmt_companyName;
DEALLOCATE PREPARE stmt_companyName;

SET @has_primaryDecisionMaker := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'primaryDecisionMaker');
SET @type_primaryDecisionMaker := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'primaryDecisionMaker' AND data_type = 'text');
SET @sql_primaryDecisionMaker := CASE
  WHEN @has_primaryDecisionMaker = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `primaryDecisionMaker` TEXT NULL'
  WHEN @type_primaryDecisionMaker = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `primaryDecisionMaker` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_primaryDecisionMaker FROM @sql_primaryDecisionMaker;
EXECUTE stmt_primaryDecisionMaker;
DEALLOCATE PREPARE stmt_primaryDecisionMaker;

SET @has_designation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'designation');
SET @type_designation := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'designation' AND data_type = 'text');
SET @sql_designation := CASE
  WHEN @has_designation = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `designation` TEXT NULL'
  WHEN @type_designation = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `designation` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_designation FROM @sql_designation;
EXECUTE stmt_designation;
DEALLOCATE PREPARE stmt_designation;

SET @has_contactNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'contactNumber');
SET @type_contactNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'contactNumber' AND data_type = 'text');
SET @sql_contactNumber := CASE
  WHEN @has_contactNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `contactNumber` TEXT NULL'
  WHEN @type_contactNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `contactNumber` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_contactNumber FROM @sql_contactNumber;
EXECUTE stmt_contactNumber;
DEALLOCATE PREPARE stmt_contactNumber;

SET @has_alternateMobileNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'alternateMobileNumber');
SET @type_alternateMobileNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'alternateMobileNumber' AND data_type = 'text');
SET @sql_alternateMobileNumber := CASE
  WHEN @has_alternateMobileNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `alternateMobileNumber` TEXT NULL'
  WHEN @type_alternateMobileNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `alternateMobileNumber` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_alternateMobileNumber FROM @sql_alternateMobileNumber;
EXECUTE stmt_alternateMobileNumber;
DEALLOCATE PREPARE stmt_alternateMobileNumber;

SET @has_officialEmailId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'officialEmailId');
SET @type_officialEmailId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'officialEmailId' AND data_type = 'text');
SET @sql_officialEmailId := CASE
  WHEN @has_officialEmailId = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `officialEmailId` TEXT NULL'
  WHEN @type_officialEmailId = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `officialEmailId` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_officialEmailId FROM @sql_officialEmailId;
EXECUTE stmt_officialEmailId;
DEALLOCATE PREPARE stmt_officialEmailId;

SET @has_companyWebsite := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyWebsite');
SET @type_companyWebsite := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyWebsite' AND data_type = 'text');
SET @sql_companyWebsite := CASE
  WHEN @has_companyWebsite = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `companyWebsite` TEXT NULL'
  WHEN @type_companyWebsite = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `companyWebsite` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_companyWebsite FROM @sql_companyWebsite;
EXECUTE stmt_companyWebsite;
DEALLOCATE PREPARE stmt_companyWebsite;

SET @has_companyType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyType');
SET @type_companyType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companyType' AND data_type = 'text');
SET @sql_companyType := CASE
  WHEN @has_companyType = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `companyType` TEXT NULL'
  WHEN @type_companyType = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `companyType` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_companyType FROM @sql_companyType;
EXECUTE stmt_companyType;
DEALLOCATE PREPARE stmt_companyType;

SET @has_companySize := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companySize');
SET @type_companySize := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'companySize' AND data_type = 'text');
SET @sql_companySize := CASE
  WHEN @has_companySize = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `companySize` TEXT NULL'
  WHEN @type_companySize = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `companySize` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_companySize FROM @sql_companySize;
EXECUTE stmt_companySize;
DEALLOCATE PREPARE stmt_companySize;

SET @has_branches := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'branches');
SET @type_branches := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'branches' AND data_type = 'text');
SET @sql_branches := CASE
  WHEN @has_branches = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `branches` TEXT NULL'
  WHEN @type_branches = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `branches` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_branches FROM @sql_branches;
EXECUTE stmt_branches;
DEALLOCATE PREPARE stmt_branches;

SET @has_projectType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'projectType');
SET @type_projectType := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'projectType' AND data_type = 'text');
SET @sql_projectType := CASE
  WHEN @has_projectType = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `projectType` TEXT NULL'
  WHEN @type_projectType = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `projectType` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_projectType FROM @sql_projectType;
EXECUTE stmt_projectType;
DEALLOCATE PREPARE stmt_projectType;

SET @has_shootCity := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootCity');
SET @type_shootCity := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shootCity' AND data_type = 'text');
SET @sql_shootCity := CASE
  WHEN @has_shootCity = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `shootCity` TEXT NULL'
  WHEN @type_shootCity = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `shootCity` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_shootCity FROM @sql_shootCity;
EXECUTE stmt_shootCity;
DEALLOCATE PREPARE stmt_shootCity;

SET @has_expectedBudget := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'expectedBudget');
SET @type_expectedBudget := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'expectedBudget' AND data_type = 'text');
SET @sql_expectedBudget := CASE
  WHEN @has_expectedBudget = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `expectedBudget` TEXT NULL'
  WHEN @type_expectedBudget = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `expectedBudget` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_expectedBudget FROM @sql_expectedBudget;
EXECUTE stmt_expectedBudget;
DEALLOCATE PREPARE stmt_expectedBudget;

SET @has_competitions := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'competitions');
SET @type_competitions := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'competitions' AND data_type = 'text');
SET @sql_competitions := CASE
  WHEN @has_competitions = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `competitions` TEXT NULL'
  WHEN @type_competitions = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `competitions` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_competitions FROM @sql_competitions;
EXECUTE stmt_competitions;
DEALLOCATE PREPARE stmt_competitions;

SET @has_sourceEnquiryId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'sourceEnquiryId');
SET @type_sourceEnquiryId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'sourceEnquiryId' AND data_type = 'text');
SET @sql_sourceEnquiryId := CASE
  WHEN @has_sourceEnquiryId = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `sourceEnquiryId` TEXT NULL'
  WHEN @type_sourceEnquiryId = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `sourceEnquiryId` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_sourceEnquiryId FROM @sql_sourceEnquiryId;
EXECUTE stmt_sourceEnquiryId;
DEALLOCATE PREPARE stmt_sourceEnquiryId;

SET @has_sourceRowNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'sourceRowNumber');
SET @type_sourceRowNumber := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'sourceRowNumber' AND data_type = 'text');
SET @sql_sourceRowNumber := CASE
  WHEN @has_sourceRowNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `sourceRowNumber` TEXT NULL'
  WHEN @type_sourceRowNumber = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `sourceRowNumber` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_sourceRowNumber FROM @sql_sourceRowNumber;
EXECUTE stmt_sourceRowNumber;
DEALLOCATE PREPARE stmt_sourceRowNumber;

SET @has_spreadsheetId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'spreadsheetId');
SET @type_spreadsheetId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'spreadsheetId' AND data_type = 'text');
SET @sql_spreadsheetId := CASE
  WHEN @has_spreadsheetId = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `spreadsheetId` TEXT NULL'
  WHEN @type_spreadsheetId = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `spreadsheetId` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_spreadsheetId FROM @sql_spreadsheetId;
EXECUTE stmt_spreadsheetId;
DEALLOCATE PREPARE stmt_spreadsheetId;

SET @has_gid := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'gid');
SET @type_gid := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'gid' AND data_type = 'text');
SET @sql_gid := CASE
  WHEN @has_gid = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `gid` TEXT NULL'
  WHEN @type_gid = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `gid` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_gid FROM @sql_gid;
EXECUTE stmt_gid;
DEALLOCATE PREPARE stmt_gid;

SET @has_targetTab := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'targetTab');
SET @type_targetTab := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'targetTab' AND data_type = 'text');
SET @sql_targetTab := CASE
  WHEN @has_targetTab = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `targetTab` TEXT NULL'
  WHEN @type_targetTab = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `targetTab` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_targetTab FROM @sql_targetTab;
EXECUTE stmt_targetTab;
DEALLOCATE PREPARE stmt_targetTab;

SET @has_systemTableId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'systemTableId');
SET @type_systemTableId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'systemTableId' AND data_type = 'text');
SET @sql_systemTableId := CASE
  WHEN @has_systemTableId = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `systemTableId` TEXT NULL'
  WHEN @type_systemTableId = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `systemTableId` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_systemTableId FROM @sql_systemTableId;
EXECUTE stmt_systemTableId;
DEALLOCATE PREPARE stmt_systemTableId;

SET @has_lastSourceSyncAt := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastSourceSyncAt');
SET @type_lastSourceSyncAt := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'lastSourceSyncAt' AND data_type = 'text');
SET @sql_lastSourceSyncAt := CASE
  WHEN @has_lastSourceSyncAt = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `lastSourceSyncAt` TEXT NULL'
  WHEN @type_lastSourceSyncAt = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `lastSourceSyncAt` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_lastSourceSyncAt FROM @sql_lastSourceSyncAt;
EXECUTE stmt_lastSourceSyncAt;
DEALLOCATE PREPARE stmt_lastSourceSyncAt;

SET @has_nextFollowUpTime := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'nextFollowUpTime');
SET @type_nextFollowUpTime := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'nextFollowUpTime' AND data_type = 'text');
SET @sql_nextFollowUpTime := CASE
  WHEN @has_nextFollowUpTime = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `nextFollowUpTime` TEXT NULL'
  WHEN @type_nextFollowUpTime = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `nextFollowUpTime` TEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_nextFollowUpTime FROM @sql_nextFollowUpTime;
EXECUTE stmt_nextFollowUpTime;
DEALLOCATE PREPARE stmt_nextFollowUpTime;

SET @has_shoots := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shoots');
SET @type_shoots := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'shoots' AND data_type = 'longtext');
SET @sql_shoots := CASE
  WHEN @has_shoots = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `shoots` LONGTEXT NULL'
  WHEN @type_shoots = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `shoots` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_shoots FROM @sql_shoots;
EXECUTE stmt_shoots;
DEALLOCATE PREPARE stmt_shoots;

SET @has_remarkEntries := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarkEntries');
SET @type_remarkEntries := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'remarkEntries' AND data_type = 'longtext');
SET @sql_remarkEntries := CASE
  WHEN @has_remarkEntries = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `remarkEntries` LONGTEXT NULL'
  WHEN @type_remarkEntries = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `remarkEntries` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_remarkEntries FROM @sql_remarkEntries;
EXECUTE stmt_remarkEntries;
DEALLOCATE PREPARE stmt_remarkEntries;

SET @has_attachments := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'attachments');
SET @type_attachments := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'attachments' AND data_type = 'longtext');
SET @sql_attachments := CASE
  WHEN @has_attachments = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `attachments` LONGTEXT NULL'
  WHEN @type_attachments = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `attachments` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_attachments FROM @sql_attachments;
EXECUTE stmt_attachments;
DEALLOCATE PREPARE stmt_attachments;

SET @has_customFields := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'customFields');
SET @type_customFields := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'customFields' AND data_type = 'longtext');
SET @sql_customFields := CASE
  WHEN @has_customFields = 0 THEN 'ALTER TABLE `SalesCrmLead` ADD COLUMN `customFields` LONGTEXT NULL'
  WHEN @type_customFields = 0 THEN 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `customFields` LONGTEXT NULL'
  ELSE 'DO 0' END;
PREPARE stmt_customFields FROM @sql_customFields;
EXECUTE stmt_customFields;
DEALLOCATE PREPARE stmt_customFields;


-- The two legacy blobs are relaxed to NULL rather than dropped.
--
-- `schema.prisma` no longer declares them, and the runtime drops them itself once it has
-- backfilled the flat columns (`ensureCrmLeadLegacyColumnsRemoved`). But they were created
-- `NOT NULL` with no default, and that backfill only runs when there are rows to convert - so on a
-- fresh install they survive, and the first lead insert fails with error 1364, field `leadJson`
-- doesn't have a default value. Making them nullable is what lets a fresh database accept a lead.
--
-- They are deliberately NOT dropped here: on a database still holding un-backfilled JSON that would
-- destroy the only copy. The runtime removes them after it has converted them, which is the one
-- point at which doing so is safe.
SET @has_leadJson := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'leadJson' AND is_nullable = 'NO');
SET @sql_leadJson := IF(@has_leadJson = 1, 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `leadJson` JSON NULL', 'DO 0');
PREPARE stmt_leadJson FROM @sql_leadJson;
EXECUTE stmt_leadJson;
DEALLOCATE PREPARE stmt_leadJson;

SET @has_detailsJson := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'detailsJson' AND is_nullable = 'NO');
SET @sql_detailsJson := IF(@has_detailsJson = 1, 'ALTER TABLE `SalesCrmLead` MODIFY COLUMN `detailsJson` JSON NULL', 'DO 0');
PREPARE stmt_detailsJson FROM @sql_detailsJson;
EXECUTE stmt_detailsJson;
DEALLOCATE PREPARE stmt_detailsJson;
