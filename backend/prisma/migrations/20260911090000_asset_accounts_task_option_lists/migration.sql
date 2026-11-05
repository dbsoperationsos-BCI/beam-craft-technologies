-- Ten more dropdowns the studio could not edit, each written into the code where it was read.
--
-- Every one is plain vocabulary - what state an asset is in, how it travels, what a vendor is
-- engaged for - as opposed to a workflow state the code branches on. Statuses stay in the code:
-- renaming COMPLETED would strand every completed task, and a state machine's states are not a list.
--
-- Two carry their meaning on the row, the way `settles_balance` does for a payment schedule:
-- `asks_for_details` on a task type is what "Other" meant, and `means_excess` on a settlement is
-- what "Expense Excess" meant. Both were literal strings compared on the server AND in the browser.
--
-- Assets and Client Storage get a list each of Conditions and Shipment Types rather than sharing
-- one, by the studio's choice: the words match today but the two are judged differently.
--
-- Seeded with exactly what the arrays held, so nothing already recorded stops matching. Written by
-- hand and applied with `prisma migrate deploy`; index names stay inside MySQL's 64-character limit.


CREATE TABLE `asset_condition` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `asset_condition_code_key`(`code`),
  INDEX `asset_condition_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `asset_condition` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'EXCELLENT' AS `code`, 'Excellent' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'GOOD', 'Good', 1, NOW(3)
  UNION ALL SELECT 'FAIR', 'Fair', 2, NOW(3)
  UNION ALL SELECT 'DAMAGED', 'Damaged', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `asset_condition` `existing`);

CREATE TABLE `asset_repair_severity` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `asset_repair_severity_code_key`(`code`),
  INDEX `asset_repair_severity_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `asset_repair_severity` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'LOW' AS `code`, 'Low' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'MEDIUM', 'Medium', 1, NOW(3)
  UNION ALL SELECT 'HIGH', 'High', 2, NOW(3)
  UNION ALL SELECT 'CRITICAL', 'Critical', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `asset_repair_severity` `existing`);

CREATE TABLE `asset_shipment_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `asset_shipment_type_code_key`(`code`),
  INDEX `asset_shipment_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `asset_shipment_type` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'HAND_DELIVERY' AS `code`, 'Hand Delivery' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'COURIER', 'Courier', 1, NOW(3)
  UNION ALL SELECT 'TRANSPORT', 'Transport', 2, NOW(3)
  UNION ALL SELECT 'INTERNAL_TRANSFER', 'Internal Transfer', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `asset_shipment_type` `existing`);

CREATE TABLE `storage_condition` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `storage_condition_code_key`(`code`),
  INDEX `storage_condition_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `storage_condition` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'EXCELLENT' AS `code`, 'Excellent' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'GOOD', 'Good', 1, NOW(3)
  UNION ALL SELECT 'FAIR', 'Fair', 2, NOW(3)
  UNION ALL SELECT 'DAMAGED', 'Damaged', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `storage_condition` `existing`);

CREATE TABLE `storage_shipment_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `storage_shipment_type_code_key`(`code`),
  INDEX `storage_shipment_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `storage_shipment_type` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'HAND_DELIVERY' AS `code`, 'Hand Delivery' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'COURIER', 'Courier', 1, NOW(3)
  UNION ALL SELECT 'TRANSPORT', 'Transport', 2, NOW(3)
  UNION ALL SELECT 'INTERNAL_TRANSFER', 'Internal Transfer', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `storage_shipment_type` `existing`);

CREATE TABLE `vendor_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `vendor_type_code_key`(`code`),
  INDEX `vendor_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `vendor_type` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'PHOTOGRAPHER' AS `code`, 'Photographer' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'EDITOR', 'Editor', 1, NOW(3)
  UNION ALL SELECT 'MAKEUP_ARTIST', 'Makeup Artist', 2, NOW(3)
  UNION ALL SELECT 'PRINTING', 'Printing', 3, NOW(3)
  UNION ALL SELECT 'RENTAL', 'Rental', 4, NOW(3)
  UNION ALL SELECT 'VIDEOGRAPHER', 'Videographer', 5, NOW(3)
  UNION ALL SELECT 'DRONE_OPERATOR', 'Drone Operator', 6, NOW(3)
  UNION ALL SELECT 'ALBUM_DESIGNER', 'Album Designer', 7, NOW(3)
  UNION ALL SELECT 'LIGHTING', 'Lighting', 8, NOW(3)
  UNION ALL SELECT 'SOUND', 'Sound', 9, NOW(3)
  UNION ALL SELECT 'LIVE_STREAMING', 'Live Streaming', 10, NOW(3)
  UNION ALL SELECT 'ANCHOR', 'Anchor', 11, NOW(3)
  UNION ALL SELECT 'EVENT_MANAGEMENT', 'Event Management', 12, NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', 13, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `vendor_type` `existing`);

CREATE TABLE `bank_account_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bank_account_type_code_key`(`code`),
  INDEX `bank_account_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `bank_account_type` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'SAVINGS' AS `code`, 'Savings' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'CURRENT', 'Current', 1, NOW(3)
  UNION ALL SELECT 'OVERDRAFT', 'Overdraft', 2, NOW(3)
  UNION ALL SELECT 'CASH_CREDIT', 'Cash Credit', 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `bank_account_type` `existing`);

CREATE TABLE `offer_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `offer_type_code_key`(`code`),
  INDEX `offer_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `offer_type` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'HALDI' AS `code`, 'Haldi' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'BRIDE_HALDI', 'Bride Haldi', 1, NOW(3)
  UNION ALL SELECT 'GROOM_HALDI', 'Groom Haldi', 2, NOW(3)
  UNION ALL SELECT 'NEW_BORN', 'New Born', 3, NOW(3)
  UNION ALL SELECT 'BABY_SHOOT_IH', 'Baby Shoot IH', 4, NOW(3)
  UNION ALL SELECT 'BABY_SHOOT_OH', 'Baby Shoot OH', 5, NOW(3)
  UNION ALL SELECT 'BIRTHDAY_SHOOT', 'Birthday Shoot', 6, NOW(3)
  UNION ALL SELECT 'ENGAGEMENT', 'Engagement', 7, NOW(3)
  UNION ALL SELECT 'PRE_WEDDING', 'Pre Wedding', 8, NOW(3)
  UNION ALL SELECT 'MEHANDI', 'Mehandi', 9, NOW(3)
  UNION ALL SELECT 'WEDDING', 'Wedding', 10, NOW(3)
  UNION ALL SELECT 'POST_WEDDING', 'Post Wedding', 11, NOW(3)
  UNION ALL SELECT 'BABY_SHOWER', 'Baby Shower', 12, NOW(3)
  UNION ALL SELECT 'MATERNITY_IH', 'Maternity IH', 13, NOW(3)
  UNION ALL SELECT 'MATERNITY_OH', 'Maternity OH', 14, NOW(3)
  UNION ALL SELECT 'RECEPTION', 'Reception', 15, NOW(3)
  UNION ALL SELECT 'COUPLE_SHOOT_IH', 'Couple Shoot IH', 16, NOW(3)
  UNION ALL SELECT 'NAMING_CEREMONY', 'Naming ceremony', 17, NOW(3)
  UNION ALL SELECT 'FAMILY', 'Family', 18, NOW(3)
  UNION ALL SELECT 'CORPORATE', 'Corporate', 19, NOW(3)
  UNION ALL SELECT 'WEDDING_RECEPTION', 'Wedding + Reception', 20, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `offer_type` `existing`);

CREATE TABLE `task_type` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `asks_for_details` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `task_type_code_key`(`code`),
  INDEX `task_type_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `task_type` (`code`, `name`, `asks_for_details`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'CLIENT' AS `code`, 'Client' AS `name`, false AS `asks_for_details`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'INTERNAL', 'Internal', false, 1, NOW(3)
  UNION ALL SELECT 'ADMINISTRATIVE', 'Administrative', false, 2, NOW(3)
  UNION ALL SELECT 'FOLLOW_UP', 'Follow Up', false, 3, NOW(3)
  UNION ALL SELECT 'ESCALATION', 'Escalation', false, 4, NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', true, 5, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `task_type` `existing`);

CREATE TABLE `payment_settlement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `means_excess` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_settlement_code_key`(`code`),
  INDEX `payment_settlement_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `payment_settlement` (`code`, `name`, `means_excess`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'EXPENSE_EXCESS' AS `code`, 'Expense Excess' AS `name`, true AS `means_excess`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'REIMBURSEMENT_NEEDED', 'Reimbursement needed', false, 1, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `payment_settlement` `existing`);
