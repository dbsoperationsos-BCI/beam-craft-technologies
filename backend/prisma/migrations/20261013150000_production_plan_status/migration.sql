-- A production plan's own status set by hand - HOLD or REJECTED, with remarks, when and by whom
-- (production/plan.js). Apart from the shoot day's status (`shoot_status`). Empty means automatic:
-- Yet to Start, WIP or Planned from the plan. Columns only; no row is changed.
ALTER TABLE `project_production`
    ADD COLUMN `plan_status` VARCHAR(20) NULL,
    ADD COLUMN `plan_status_remarks` TEXT NULL,
    ADD COLUMN `plan_status_at` DATETIME(3) NULL,
    ADD COLUMN `plan_status_by_user_id` INTEGER NULL;

CREATE INDEX `project_production_plan_status_by_user_id_idx` ON `project_production`(`plan_status_by_user_id`);

ALTER TABLE `project_production` ADD CONSTRAINT `project_production_plan_status_by_user_id_fkey` FOREIGN KEY (`plan_status_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
