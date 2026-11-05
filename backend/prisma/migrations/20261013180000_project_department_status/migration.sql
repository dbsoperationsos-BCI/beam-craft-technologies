-- A project's overall Pre Production and Production status, set by hand.
--
-- Both are worked out from the project's shoots. These let the Pre Production and Production boards
-- set them for a project directly - one project from its row's menu, or several ticked at once:
-- Hold or Rejected with remarks, or back to automatic (NULL). Setting one never changes a shoot. Who set it and when is kept beside it.
--
-- Cost: eight nullable columns, two indexes and two foreign keys on sales_project. No data written.

-- AlterTable
ALTER TABLE `sales_project` ADD COLUMN `pre_production_status` VARCHAR(20) NULL,
    ADD COLUMN `pre_production_status_at` DATETIME(3) NULL,
    ADD COLUMN `pre_production_status_by_user_id` INTEGER NULL,
    ADD COLUMN `pre_production_status_remarks` TEXT NULL,
    ADD COLUMN `production_status` VARCHAR(20) NULL,
    ADD COLUMN `production_status_at` DATETIME(3) NULL,
    ADD COLUMN `production_status_by_user_id` INTEGER NULL,
    ADD COLUMN `production_status_remarks` TEXT NULL;

-- CreateIndex
CREATE INDEX `sales_project_pre_production_status_by_user_id_idx` ON `sales_project`(`pre_production_status_by_user_id`);

-- CreateIndex
CREATE INDEX `sales_project_production_status_by_user_id_idx` ON `sales_project`(`production_status_by_user_id`);

-- AddForeignKey
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_pre_production_status_by_user_id_fkey` FOREIGN KEY (`pre_production_status_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_production_status_by_user_id_fkey` FOREIGN KEY (`production_status_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
