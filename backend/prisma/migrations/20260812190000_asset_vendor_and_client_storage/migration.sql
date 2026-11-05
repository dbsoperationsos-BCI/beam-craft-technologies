-- Squashed migration: vendor management, asset inspections and requests, and client storage.
--
-- Combines the twenty step-by-step migrations written while these modules were being built, in
-- the order Prisma would have applied them. The data statements are kept exactly as they were:
-- regenerating this from the schema would have produced the tables but not the backfills.

-- ---------------------------------------------------------------------------
-- 20260810120000_add_vendor_management
-- ---------------------------------------------------------------------------

CREATE TABLE `Vendor` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `vendor_id` VARCHAR(30) NOT NULL,
  `vendor_name` VARCHAR(191) NOT NULL,
  `vendor_type` VARCHAR(100) NOT NULL,
  `contact_person` VARCHAR(150) NULL,
  `mobile_number` VARCHAR(30) NULL,
  `whatsapp_number` VARCHAR(30) NULL,
  `alternate_number` VARCHAR(30) NULL,
  `email` VARCHAR(191) NULL,
  `gst_number` VARCHAR(30) NULL,
  `pan_number` VARCHAR(20) NULL,
  `aadhaar_number` VARCHAR(20) NULL,
  `business_registration_name` VARCHAR(191) NULL,
  `address` TEXT NULL, `city` VARCHAR(100) NULL, `state` VARCHAR(100) NULL,
  `country` VARCHAR(100) NULL, `pincode` VARCHAR(15) NULL,
  `bank_name` VARCHAR(150) NULL, `account_number` VARCHAR(100) NULL,
  `ifsc_code` VARCHAR(30) NULL, `upi_id` VARCHAR(100) NULL,
  `website` VARCHAR(500) NULL, `instagram` VARCHAR(500) NULL, `facebook` VARCHAR(500) NULL,
  `business_start_year` INTEGER NULL,
  `preferred_languages` JSON NULL, `skills` JSON NULL, `rating` INTEGER NULL,
  `status` ENUM('ACTIVE', 'INACTIVE', 'ON_HOLD') NOT NULL DEFAULT 'ACTIVE',
  `status_reason` TEXT NULL, `referred_by` VARCHAR(191) NULL, `remarks` TEXT NULL,
  `is_deleted` BOOLEAN NOT NULL DEFAULT false, `deleted_reason` TEXT NULL, `deleted_at` DATETIME(3) NULL,
  `created_by` INTEGER NULL, `updated_by` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Vendor_vendor_id_key`(`vendor_id`), INDEX `Vendor_vendor_name_idx`(`vendor_name`),
  INDEX `Vendor_vendor_type_idx`(`vendor_type`), INDEX `Vendor_status_is_deleted_idx`(`status`, `is_deleted`),
  INDEX `Vendor_created_at_idx`(`created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- 20260810130000_add_vendor_address_details
-- ---------------------------------------------------------------------------

ALTER TABLE `Vendor`
  ADD COLUMN `area` VARCHAR(150) NULL AFTER `address`,
  ADD COLUMN `district` VARCHAR(100) NULL AFTER `city`;


-- ---------------------------------------------------------------------------
-- 20260810140000_remove_vendor_on_hold_add_source
-- ---------------------------------------------------------------------------

UPDATE `Vendor`
SET `status` = 'INACTIVE',
    `status_reason` = COALESCE(`status_reason`, 'Converted from On Hold when that status was retired')
WHERE `status` = 'ON_HOLD';

ALTER TABLE `Vendor`
  MODIFY COLUMN `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `source_type` VARCHAR(10) NOT NULL DEFAULT 'EXT' AFTER `vendor_type`;


-- ---------------------------------------------------------------------------
-- 20260810150000_add_asset_inspections
-- ---------------------------------------------------------------------------

ALTER TABLE `Asset`
  ADD COLUMN `inspection_code` VARCHAR(30) NULL,
  ADD COLUMN `inspection_condition` VARCHAR(30) NULL,
  ADD COLUMN `inspection_remarks` TEXT NULL,
  ADD COLUMN `inspected_on` DATETIME(3) NULL,
  ADD COLUMN `inspected_by_user_id` INTEGER NULL,
  ADD COLUMN `inspected_by_employee_id` VARCHAR(50) NULL,
  ADD COLUMN `inspected_by_name` VARCHAR(150) NULL,
  ADD COLUMN `last_inspection_images` JSON NULL,
  ADD COLUMN `last_inspection_image_metadata` JSON NULL,
  ADD COLUMN `current_inspection_images` JSON NULL,
  ADD COLUMN `current_inspection_image_metadata` JSON NULL,
  ADD UNIQUE INDEX `Asset_inspection_code_key`(`inspection_code`);


-- ---------------------------------------------------------------------------
-- 20260810160000_add_inspector_and_second_previous_images
-- ---------------------------------------------------------------------------

ALTER TABLE `Asset`
  ADD COLUMN `inspected_by_id` INTEGER NULL,
  ADD COLUMN `second_last_inspection_images` JSON NULL,
  ADD COLUMN `second_last_inspection_image_metadata` JSON NULL,
  ADD INDEX `Asset_inspected_by_id_idx`(`inspected_by_id`);


-- ---------------------------------------------------------------------------
-- 20260810170000_remove_duplicate_purchased_date
-- ---------------------------------------------------------------------------

-- `purchase_date` and `purchased_date` held the same value and were both surfaced as
-- "Purchase Date" / "Purchased Date" on the asset form. `purchase_date` is retained.

-- Preserve any value that exists only in the column being dropped.
UPDATE `Asset`
SET `purchase_date` = `purchased_date`
WHERE `purchase_date` IS NULL AND `purchased_date` IS NOT NULL;

ALTER TABLE `Asset` DROP COLUMN `purchased_date`;


-- ---------------------------------------------------------------------------
-- 20260810180000_add_client_storage
-- ---------------------------------------------------------------------------

-- Client Storage Management becomes its own module instead of an asset category.

CREATE TABLE `ClientStorage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `storage_id` VARCHAR(30) NOT NULL,
  `is_deleted` BOOLEAN NOT NULL DEFAULT false,
  `deleted_reason` TEXT NULL,
  `deleted_at` DATETIME(3) NULL,
  `created_by` INTEGER NULL,
  `updated_by` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ClientStorage_storage_id_key`(`storage_id`),
  INDEX `ClientStorage_is_deleted_idx`(`is_deleted`),
  INDEX `ClientStorage_created_at_idx`(`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Retire the placeholder asset category, but only when nothing is filed under it.
DELETE FROM `AssetCategory`
WHERE `code` = 'CLIENT_STORAGE_MANAGEMENT'
  AND `id` NOT IN (SELECT DISTINCT `category_id` FROM `Asset` WHERE `category_id` IS NOT NULL);


-- ---------------------------------------------------------------------------
-- 20260810180000_inspection_period_in_months
-- ---------------------------------------------------------------------------

-- Inspection periods are now captured in whole months instead of days.
ALTER TABLE `Asset` CHANGE COLUMN `inspection_period` `inspection_period_months` INTEGER NULL;

-- Existing values were stored as days; convert to the nearest month and keep any
-- non-zero period at a minimum of one month so short cycles do not become "no period".
UPDATE `Asset`
SET `inspection_period_months` = CASE
    WHEN `inspection_period_months` = 0 THEN 0
    ELSE GREATEST(1, ROUND(`inspection_period_months` / 30))
  END
WHERE `inspection_period_months` IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 20260810190000_add_asset_manager
-- ---------------------------------------------------------------------------

-- Each asset can name the employee responsible for managing it, alongside its assigned person.

ALTER TABLE `Asset` ADD COLUMN `manager_id` INTEGER NULL;

CREATE INDEX `Asset_manager_id_idx` ON `Asset`(`manager_id`);

ALTER TABLE `Asset`
  ADD CONSTRAINT `Asset_manager_id_fkey`
  FOREIGN KEY (`manager_id`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260810190000_client_storage_fields
-- ---------------------------------------------------------------------------

-- Client storage records carry the hard-disc and footage detail for a shoot. The shoot, client,
-- project status and coordinator columns are deliberately absent: they are read through the
-- `shoot_id` link so a storage row can never disagree with the shoot it belongs to.
ALTER TABLE `ClientStorage`
  ADD COLUMN `shoot_id` VARCHAR(191) NULL,
  ADD COLUMN `product` VARCHAR(191) NULL,
  ADD COLUMN `type` VARCHAR(191) NULL,
  ADD COLUMN `wid` VARCHAR(100) NULL,
  ADD COLUMN `work_type` VARCHAR(191) NULL,
  ADD COLUMN `footage_location` VARCHAR(191) NULL,
  ADD COLUMN `storage_type` VARCHAR(100) NULL,
  ADD COLUMN `footage_link` TEXT NULL,
  ADD COLUMN `remarks` TEXT NULL,
  ADD COLUMN `hard_disc_brand` VARCHAR(100) NULL,
  ADD COLUMN `hard_disc_colour` VARCHAR(80) NULL,
  ADD COLUMN `hard_disc_capacity` VARCHAR(50) NULL,
  ADD COLUMN `items` VARCHAR(191) NULL,
  ADD COLUMN `footage_size` VARCHAR(50) NULL,
  ADD COLUMN `hard_disk_in` VARCHAR(40) NULL,
  ADD COLUMN `labeled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `footage_backup` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `final_files_copy` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `harddisk_footages_backup` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `folder_structure_checked` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `final_renders` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `other_files_in_harddisk` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `ClientStorage_shoot_id_idx` ON `ClientStorage`(`shoot_id`);

-- SET NULL rather than CASCADE: deleting a shoot must not silently destroy the record of which
-- hard disc its footage is on.
ALTER TABLE `ClientStorage`
  ADD CONSTRAINT `ClientStorage_shoot_id_fkey`
  FOREIGN KEY (`shoot_id`) REFERENCES `ProjectShoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260811120000_client_storage_project_link
-- ---------------------------------------------------------------------------

-- A client storage record belongs to a project, not only to a shoot. Storage records are raised
-- automatically the moment a project is started with "Storage Needed = Yes", which can happen
-- before the project has any shoots, so the project link is what identifies the record and the
-- shoot link is filled in once there is a shoot to point at.
ALTER TABLE `ClientStorage`
  ADD COLUMN `project_id` VARCHAR(191) NULL;

-- Existing records were only ever reachable through their shoot, so their project is whichever
-- project that shoot belongs to. `ProjectShoot` is a sales table, whose columns are camelCase
-- rather than the snake_case the asset tables use.
UPDATE `ClientStorage` AS `storage`
  JOIN `ProjectShoot` AS `shoot` ON `shoot`.`id` = `storage`.`shoot_id`
  SET `storage`.`project_id` = `shoot`.`projectId`;

CREATE INDEX `ClientStorage_project_id_idx` ON `ClientStorage`(`project_id`);

-- SET NULL for the same reason as the shoot link: removing the project must not destroy the
-- record of which hard disc the footage ended up on.
ALTER TABLE `ClientStorage`
  ADD CONSTRAINT `ClientStorage_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `SalesProject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260811140000_client_storage_status
-- ---------------------------------------------------------------------------

-- A storage record now carries where it has reached: it is raised as "Yet to Receive", becomes
-- "Yet to Start" once the hard disc is in hand, and reaches "Footage Backup Done" only once the
-- disc and footage details have been recorded. The status moves forward one step at a time.
ALTER TABLE `ClientStorage`
  ADD COLUMN `status` VARCHAR(40) NOT NULL DEFAULT 'Yet to Receive',
  ADD COLUMN `is_shoot_status_pending` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `ClientStorage_status_idx` ON `ClientStorage`(`status`);


-- ---------------------------------------------------------------------------
-- 20260811160000_client_storage_handover
-- ---------------------------------------------------------------------------

-- Once a storage record misses its footage backup deadline the disc itself has to travel: post
-- production takes it out, assigns it to somebody, and that person carries it to the client.
-- The assignee's name is stored beside the link so an archived employee still reads correctly.
ALTER TABLE `ClientStorage`
  ADD COLUMN `assigned_to_id` INTEGER NULL,
  ADD COLUMN `assigned_to_name` VARCHAR(150) NULL,
  ADD COLUMN `assigned_at` DATETIME(3) NULL,
  ADD COLUMN `assigned_by_id` INTEGER NULL;

CREATE INDEX `ClientStorage_assigned_to_id_idx` ON `ClientStorage`(`assigned_to_id`);

-- SET NULL rather than RESTRICT: archiving an employee must not be blocked by a storage record
-- they once carried, and the assignee's name is kept on the record regardless.
ALTER TABLE `ClientStorage`
  ADD CONSTRAINT `ClientStorage_assigned_to_id_fkey`
  FOREIGN KEY (`assigned_to_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260811180000_client_storage_transit_details
-- ---------------------------------------------------------------------------

-- The In Transit step records how the hard disc travels to the client, mirroring the details the
-- asset In Transit status already collects. The three upload columns hold `{ name, url }` entries
-- pointing at object storage, the same shape Asset.documents uses.
ALTER TABLE `ClientStorage`
  ADD COLUMN `transit_condition` VARCHAR(40) NULL,
  ADD COLUMN `transit_damage_remarks` TEXT NULL,
  ADD COLUMN `transit_current_photo` JSON NULL,
  ADD COLUMN `transfer_from` VARCHAR(191) NULL,
  ADD COLUMN `transfer_to` VARCHAR(191) NULL,
  ADD COLUMN `sent_by` VARCHAR(150) NULL,
  ADD COLUMN `sent_by_phone` VARCHAR(30) NULL,
  ADD COLUMN `received_by` VARCHAR(150) NULL,
  ADD COLUMN `received_by_phone` VARCHAR(30) NULL,
  ADD COLUMN `courier_service` VARCHAR(150) NULL,
  ADD COLUMN `tracking_number` VARCHAR(100) NULL,
  ADD COLUMN `shipment_date_time` DATETIME(3) NULL,
  ADD COLUMN `shipment_eta` DATETIME(3) NULL,
  ADD COLUMN `courier_charge` DECIMAL(12, 2) NULL,
  ADD COLUMN `shipment_type` VARCHAR(40) NULL,
  ADD COLUMN `courier_receipt` JSON NULL,
  ADD COLUMN `package_photo` JSON NULL,
  ADD COLUMN `transfer_reason` TEXT NULL,
  ADD COLUMN `special_instructions` TEXT NULL;


-- ---------------------------------------------------------------------------
-- 20260811200000_client_storage_hdd_out_photo
-- ---------------------------------------------------------------------------

-- The hard disc is photographed as it goes out, on the move from "Footage Backup Done" to
-- "HDD Out". Holds the same `{ url, byteSize, width, height, mimeType, originalByteSize }` entries
-- as the transit photos, so what was compressed and uploaded can be checked afterwards.
ALTER TABLE `ClientStorage`
  ADD COLUMN `hdd_out_photo` JSON NULL;


-- ---------------------------------------------------------------------------
-- 20260811220000_add_asset_requests
-- ---------------------------------------------------------------------------

-- Somebody asking for an asset that does not exist yet. RESTRICT on both category links matches
-- Asset.categoryId: a category that has been asked for cannot be deleted out from under the
-- request that names it.
CREATE TABLE `AssetRequest` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `request_code` VARCHAR(30) NOT NULL,
  `asset_name` VARCHAR(150) NOT NULL,
  `category_id` VARCHAR(191) NOT NULL,
  `sub_category_id` VARCHAR(191) NULL,
  `remarks` TEXT NULL,
  `requested_by` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `AssetRequest_request_code_key`(`request_code`),
  INDEX `AssetRequest_category_id_idx`(`category_id`),
  INDEX `AssetRequest_sub_category_id_idx`(`sub_category_id`),
  INDEX `AssetRequest_created_at_idx`(`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AssetRequest`
  ADD CONSTRAINT `AssetRequest_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `AssetCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AssetRequest`
  ADD CONSTRAINT `AssetRequest_sub_category_id_fkey`
  FOREIGN KEY (`sub_category_id`) REFERENCES `AssetCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260812120000_add_asset_request_decisions
-- ---------------------------------------------------------------------------

-- An asset request now carries the admin's decision. Rows that already exist were raised before
-- anyone could decide on them, so the DEFAULT leaves them PENDING and waiting for one.
--
-- SET NULL on the asset link: an asset added for an approved request can later be removed, and the
-- request should keep its APPROVED history rather than block the deletion.
ALTER TABLE `AssetRequest`
  ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `decision_remarks` TEXT NULL,
  ADD COLUMN `decided_by` INTEGER NULL,
  ADD COLUMN `decided_at` DATETIME(3) NULL,
  ADD COLUMN `asset_id` INTEGER NULL;

CREATE INDEX `AssetRequest_status_idx` ON `AssetRequest`(`status`);
CREATE INDEX `AssetRequest_asset_id_idx` ON `AssetRequest`(`asset_id`);

ALTER TABLE `AssetRequest`
  ADD CONSTRAINT `AssetRequest_asset_id_fkey`
  FOREIGN KEY (`asset_id`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 20260812140000_asset_log_custody_columns
-- ---------------------------------------------------------------------------

-- An asset's custody history. Until now only a status change wrote a log row, so reassigning
-- through the Edit form left no trace and the previous holder was simply overwritten.
--
-- These two columns record who the asset moved between on every change of custody, from either
-- route. They are columns rather than keys inside form_data so that "everyone who has held this
-- asset" and "everything this person has held" are both indexed queries.
ALTER TABLE `AssetStatusLog`
  ADD COLUMN `assigned_from_id` INTEGER NULL,
  ADD COLUMN `assigned_to_id` INTEGER NULL;

CREATE INDEX `AssetStatusLog_assigned_to_id_idx` ON `AssetStatusLog`(`assigned_to_id`);
CREATE INDEX `AssetStatusLog_assigned_from_id_idx` ON `AssetStatusLog`(`assigned_from_id`);

-- SET NULL rather than RESTRICT: removing an employee must not be blocked by the history of what
-- they once held, and the row keeps its name snapshot in form_data regardless.
ALTER TABLE `AssetStatusLog`
  ADD CONSTRAINT `AssetStatusLog_assigned_from_id_fkey`
  FOREIGN KEY (`assigned_from_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AssetStatusLog`
  ADD CONSTRAINT `AssetStatusLog_assigned_to_id_fkey`
  FOREIGN KEY (`assigned_to_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows already written by the Unassigned -> Active flow carry the assignee inside form_data.
-- Lifting it into the new column means the history starts complete rather than from today.
--
-- Guarded on the employee still existing: form_data is a snapshot and may name somebody since
-- deleted, which the foreign key added above would otherwise reject, failing the migration.
UPDATE `AssetStatusLog` AS `log`
  SET `log`.`assigned_to_id` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`log`.`form_data`, '$.assignedToId')) AS UNSIGNED)
  WHERE JSON_UNQUOTE(JSON_EXTRACT(`log`.`form_data`, '$.assignedToId')) REGEXP '^[0-9]+$'
    AND EXISTS (
      SELECT 1 FROM `Employee` AS `employee`
      WHERE `employee`.`id` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`log`.`form_data`, '$.assignedToId')) AS UNSIGNED)
    );


-- ---------------------------------------------------------------------------
-- 20260812160000_asset_log_change_flags
-- ---------------------------------------------------------------------------

-- Says plainly what each log row records, so reading an asset's status history or its custody
-- history is a flag test rather than a list of change_type strings to keep in sync.
--
-- They are not mutually exclusive: moving an asset from Unassigned to Active both changes its
-- status and hands it to somebody, and that row sets each of them.
ALTER TABLE `AssetStatusLog`
  ADD COLUMN `is_status_change` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_assignee_change` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `AssetStatusLog_asset_id_is_assignee_change_idx` ON `AssetStatusLog`(`asset_id`, `is_assignee_change`);

-- Every row written so far came from the status-change flow, so all of them are status changes,
-- and those that named somebody were handovers too.
UPDATE `AssetStatusLog` SET `is_status_change` = true;
UPDATE `AssetStatusLog` SET `is_assignee_change` = true WHERE `assigned_to_id` IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 20260812180000_client_storage_sold
-- ---------------------------------------------------------------------------

-- A disc in transit can end up sold rather than delivered to the client. These are the same
-- details the asset Sold status records, held as columns because a storage record has no status
-- log of its own to put them in.
ALTER TABLE `ClientStorage`
  ADD COLUMN `sold_by_name` VARCHAR(150) NULL,
  ADD COLUMN `sold_by_employee_id` VARCHAR(50) NULL,
  ADD COLUMN `sold_to_name` VARCHAR(150) NULL,
  ADD COLUMN `sold_to_contact` VARCHAR(50) NULL,
  ADD COLUMN `sold_date` DATE NULL,
  ADD COLUMN `sold_price` DECIMAL(12, 2) NULL;

