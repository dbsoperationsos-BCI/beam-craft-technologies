-- An indoor (Studio / In-House) shoot's branch: the studio it happens at, asked on Pre Production in
-- place of its location. Nullable and empty for every existing row - nothing is backfilled.
ALTER TABLE `project_pre_production` ADD COLUMN `shoot_branch_id` INTEGER NULL;

CREATE INDEX `project_pre_production_shoot_branch_id_idx` ON `project_pre_production`(`shoot_branch_id`);

ALTER TABLE `project_pre_production` ADD CONSTRAINT `project_pre_production_shoot_branch_id_fkey` FOREIGN KEY (`shoot_branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
