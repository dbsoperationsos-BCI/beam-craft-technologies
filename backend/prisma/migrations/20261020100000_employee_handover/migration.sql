-- A role handed from a leaver to the person taking over at offboarding, so screens can show the
-- holder as "New (Old)" while it is still theirs. New and empty: nothing is backfilled.
CREATE TABLE `employee_handover` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` VARCHAR(191) NULL,
    `production_id` VARCHAR(191) NULL,
    `crew_id` VARCHAR(191) NULL,
    `role` VARCHAR(60) NOT NULL,
    `from_employee_id` INTEGER NULL,
    `to_employee_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_handover_project_id_idx`(`project_id`),
    INDEX `employee_handover_production_id_idx`(`production_id`),
    INDEX `employee_handover_crew_id_idx`(`crew_id`),
    INDEX `employee_handover_from_employee_id_idx`(`from_employee_id`),
    INDEX `employee_handover_to_employee_id_idx`(`to_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_handover` ADD CONSTRAINT `employee_handover_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_handover` ADD CONSTRAINT `employee_handover_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_handover` ADD CONSTRAINT `employee_handover_crew_id_fkey` FOREIGN KEY (`crew_id`) REFERENCES `project_production_service_crew`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_handover` ADD CONSTRAINT `employee_handover_from_employee_id_fkey` FOREIGN KEY (`from_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `employee_handover` ADD CONSTRAINT `employee_handover_to_employee_id_fkey` FOREIGN KEY (`to_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
