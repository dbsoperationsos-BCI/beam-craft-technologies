-- Photo copy, per service of the shoot (production/execution.js): one row per service, written when the
-- step completes. A new table only - no existing row is touched; shoots that finished Photo copy
-- before keep their single answer on project_production.footage_*.
CREATE TABLE `project_production_footage` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `service_definition_id` VARCHAR(191) NULL,
    `footage_url` VARCHAR(2048) NOT NULL,
    `backed_up_by_employee_id` INTEGER NULL,
    `file_count` INTEGER NOT NULL,
    `size` VARCHAR(50) NOT NULL,
    `first_file_name` VARCHAR(255) NOT NULL,
    `last_file_name` VARCHAR(255) NOT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_production_footage_service_definition_id_idx`(`service_definition_id`),
    INDEX `project_production_footage_backed_up_by_employee_id_idx`(`backed_up_by_employee_id`),
    UNIQUE INDEX `project_production_footage_production_id_service_definition__key`(`production_id`, `service_definition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_production_footage` ADD CONSTRAINT `project_production_footage_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_footage` ADD CONSTRAINT `project_production_footage_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_footage` ADD CONSTRAINT `project_production_footage_backed_up_by_employee_id_fkey` FOREIGN KEY (`backed_up_by_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
