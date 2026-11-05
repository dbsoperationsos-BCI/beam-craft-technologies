CREATE TABLE `leads` (
    `external_id` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `phone` VARCHAR(30) NOT NULL DEFAULT '',
    `company` VARCHAR(191) NOT NULL DEFAULT '',
    `status` VARCHAR(50) NOT NULL DEFAULT 'new',
    `source` VARCHAR(50) NOT NULL DEFAULT 'crm',
    `source_ref` VARCHAR(191) NOT NULL DEFAULT '',
    `offer_type` VARCHAR(191) NOT NULL DEFAULT '',
    `contact_repeated` VARCHAR(191) NOT NULL DEFAULT '',
    `lead_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`external_id`),
    INDEX `leads_status_idx`(`status`),
    INDEX `leads_source_idx`(`source`),
    INDEX `leads_created_at_idx`(`created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
