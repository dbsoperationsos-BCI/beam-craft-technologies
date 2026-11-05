-- A shoot's pre production status set by hand - WCR, HOLD or REJECTED, with remarks, when and by whom
-- (pre-production/controller.js). Empty means automatic: Yet to Start, Work in Progress or Planned,
-- worked out from the shoot's details on every read. Columns only; no row is changed.
ALTER TABLE `project_pre_production`
    ADD COLUMN `shoot_status` VARCHAR(20) NULL,
    ADD COLUMN `shoot_status_remarks` TEXT NULL,
    ADD COLUMN `shoot_status_at` DATETIME(3) NULL,
    ADD COLUMN `shoot_status_by_user_id` INTEGER NULL;

CREATE INDEX `project_pre_production_shoot_status_by_user_id_idx` ON `project_pre_production`(`shoot_status_by_user_id`);

ALTER TABLE `project_pre_production` ADD CONSTRAINT `project_pre_production_shoot_status_by_user_id_fkey` FOREIGN KEY (`shoot_status_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
