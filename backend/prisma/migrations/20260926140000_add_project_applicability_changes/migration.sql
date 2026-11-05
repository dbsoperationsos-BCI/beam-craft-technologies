-- Why a project's Welcome Kit, Shoot Completed Gift, hard disk or CRD Document stopped (or started)
-- applying.
--
-- Switching one of them between applicable and not is a decision somebody asks about later, so each
-- switch is kept with the reason given, who made it and when. Written by the save that makes the
-- change; a new table with nothing to carry over.
CREATE TABLE `project_applicability_change` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `item` VARCHAR(40) NOT NULL,
    `from_value` VARCHAR(40) NULL,
    `to_value` VARCHAR(40) NULL,
    `remarks` TEXT NULL,
    `changed_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_applicability_change_project_id_created_at_idx`(`project_id`, `created_at`),
    INDEX `project_applicability_change_changed_by_user_id_idx`(`changed_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_applicability_change` ADD CONSTRAINT `project_applicability_change_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_applicability_change` ADD CONSTRAINT `project_applicability_change_changed_by_user_id_fkey`
  FOREIGN KEY (`changed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
