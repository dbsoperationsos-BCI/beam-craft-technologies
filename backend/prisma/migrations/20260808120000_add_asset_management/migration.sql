-- CreateTable
CREATE TABLE `AssetCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `code` VARCHAR(120) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `level` INTEGER NOT NULL,
    `module_type` VARCHAR(30) NOT NULL DEFAULT 'ASSET',
    `icon` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AssetCategory_code_key`(`code`),
    INDEX `AssetCategory_parent_id_idx`(`parent_id`),
    INDEX `AssetCategory_level_idx`(`level`),
    INDEX `AssetCategory_is_active_idx`(`is_active`),
    UNIQUE INDEX `AssetCategory_parent_id_name_key`(`parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_code` VARCHAR(30) NOT NULL,
    `asset_name` VARCHAR(150) NOT NULL,
    `specification` TEXT NULL,
    `company` VARCHAR(150) NULL,
    `serial_number` VARCHAR(100) NULL,
    `branch_id` INTEGER NOT NULL,
    `remarks` TEXT NULL,
    `photo_data` MEDIUMTEXT NULL,
    `assigned_person_id` INTEGER NULL,
    `category_id` VARCHAR(191) NULL,
    `color` VARCHAR(80) NULL,
    `purchase_date` DATE NULL,
    `inspection_period` INTEGER NULL,
    `last_inspected_date` DATE NULL,
    `next_inspection_date` DATE NULL,
    `purchase_price` DECIMAL(12, 2) NULL,
    `purchased_from` VARCHAR(150) NULL,
    `purchased_date` DATE NULL,
    `invoice_number` VARCHAR(100) NULL,
    `warranty_months` INTEGER NULL,
    `insurance_details` TEXT NULL,
    `insurance_expiry` DATE NULL,
    `images` JSON NULL,
    `documents` JSON NULL,
    `status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL DEFAULT 'ACTIVE',
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Asset_asset_code_key`(`asset_code`),
    UNIQUE INDEX `Asset_serial_number_key`(`serial_number`),
    INDEX `Asset_status_idx`(`status`),
    INDEX `Asset_is_deleted_idx`(`is_deleted`),
    INDEX `Asset_branch_id_idx`(`branch_id`),
    INDEX `Asset_assigned_person_id_idx`(`assigned_person_id`),
    INDEX `Asset_category_id_idx`(`category_id`),
    INDEX `Asset_next_inspection_date_idx`(`next_inspection_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetStatusLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `previous_status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL,
    `next_status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL,
    `change_type` VARCHAR(40) NOT NULL,
    `changed_by_user_id` INTEGER NULL,
    `changed_by_employee_id` VARCHAR(50) NULL,
    `changed_by_name` VARCHAR(150) NULL,
    `reason` TEXT NULL,
    `lost_by_name` VARCHAR(150) NULL,
    `lost_by_employee_id` VARCHAR(50) NULL,
    `sold_by_name` VARCHAR(150) NULL,
    `sold_by_employee_id` VARCHAR(50) NULL,
    `sold_to_name` VARCHAR(150) NULL,
    `sold_to_contact` VARCHAR(50) NULL,
    `sold_date` DATE NULL,
    `sold_price` DECIMAL(12, 2) NULL,
    `form_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetStatusLog_asset_id_created_at_idx`(`asset_id`, `created_at`),
    INDEX `AssetStatusLog_next_status_idx`(`next_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetMaintenance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `maintenance_status` ENUM('TO_REPAIR', 'IN_REPAIR', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'TO_REPAIR',
    `open_slot` INTEGER NULL DEFAULT 1,
    `repair_reason` TEXT NOT NULL,
    `repaired_by_id` INTEGER NULL,
    `repaired_date` DATE NULL,
    `service_provider` VARCHAR(200) NULL,
    `service_city` VARCHAR(100) NULL,
    `service_state` VARCHAR(100) NULL,
    `submitted_date` DATE NULL,
    `eta` DATE NULL,
    `submitted_by_id` INTEGER NULL,
    `contact` VARCHAR(150) NULL,
    `repair_cost` DECIMAL(12, 2) NULL,
    `completion_remarks` TEXT NULL,
    `received_and_checked_by_id` INTEGER NULL,
    `cancellation_reason` TEXT NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `AssetMaintenance_asset_id_idx`(`asset_id`),
    INDEX `AssetMaintenance_maintenance_status_idx`(`maintenance_status`),
    UNIQUE INDEX `AssetMaintenance_asset_id_open_slot_key`(`asset_id`, `open_slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AssetCategory` ADD CONSTRAINT `AssetCategory_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `AssetCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_assigned_person_id_fkey` FOREIGN KEY (`assigned_person_id`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `AssetCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetStatusLog` ADD CONSTRAINT `AssetStatusLog_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetMaintenance` ADD CONSTRAINT `AssetMaintenance_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetMaintenance` ADD CONSTRAINT `AssetMaintenance_repaired_by_id_fkey` FOREIGN KEY (`repaired_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetMaintenance` ADD CONSTRAINT `AssetMaintenance_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetMaintenance` ADD CONSTRAINT `AssetMaintenance_received_and_checked_by_id_fkey` FOREIGN KEY (`received_and_checked_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the currently approved company branches.
-- This is idempotent and does not delete any existing Location rows.
UPDATE `Location`
SET `isActive` = false
WHERE `code` IN ('CORP', 'DUM_DUM', 'QUA_QUA');

INSERT INTO `Location` (`code`, `name`, `description`, `isActive`, `createdAt`, `updatedAt`)
VALUES
    ('ERODE_TN', 'Erode TN', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('TIRUPPUR_TN', 'Tiruppur TN', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('COIMBATORE_TN', 'Coimbatore TN', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('BANGALORE_KA', 'Bangalore KA', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('HYDERABAD_TL', 'Hyderabad TL', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('VISAKHAPATNAM_AP', 'Visakhapatnam AP', 'Company branch', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `isActive` = true,
    `updatedAt` = CURRENT_TIMESTAMP(3);
