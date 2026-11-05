-- Production: one record per shoot of a started project that has a Production Manager.
--
-- The Production Manager fills a plan per shoot (coordinator, team, travel, tickets, remarks, and
-- who works each of the shoot's services with which camera); the Production Coordinator named in it then walks seven
-- steps on the day, strictly in order. Every action is logged, three steps post to the project's
-- WhatsApp group, and that group is linked on the project itself from Pre Production → General.
--
-- Additive only: new columns on `sales_project` are nullable and every other statement creates a
-- table, so this cannot fail on production data. Rows are raised by the application the next time
-- each project is saved or given a shoot; nothing is backfilled here.

-- AlterTable
ALTER TABLE `sales_project`
  ADD COLUMN `whatsapp_group_jid` VARCHAR(64) NULL,
  ADD COLUMN `whatsapp_group_subject` VARCHAR(500) NULL,
  ADD COLUMN `whatsapp_group_linked_by_user_id` INTEGER NULL,
  ADD COLUMN `whatsapp_group_linked_at` DATETIME(3) NULL;

CREATE INDEX `sales_project_whatsapp_group_jid_idx` ON `sales_project`(`whatsapp_group_jid`);
CREATE INDEX `sales_project_whatsapp_group_linked_by_user_id_idx` ON `sales_project`(`whatsapp_group_linked_by_user_id`);

-- CreateTable
CREATE TABLE `project_production` (
    `id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `sales_project_id` VARCHAR(191) NOT NULL,
    `branch_id` INTEGER NULL,
    `production_coordinator_employee_id` INTEGER NULL,
    `travel_mode` VARCHAR(30) NULL,
    `remarks` TEXT NULL,
    `plan_submitted_at` DATETIME(3) NULL,
    `plan_submitted_by_user_id` INTEGER NULL,
    `current_step` VARCHAR(30) NOT NULL DEFAULT 'STARTED_FROM_STUDIO',
    `started_from_studio_at` DATETIME(3) NULL,
    `reached_shoot_place_at` DATETIME(3) NULL,
    `pineapple_meeting_at` DATETIME(3) NULL,
    `shoot_started_at` DATETIME(3) NULL,
    `shoot_status_at` DATETIME(3) NULL,
    `reached_studio_at` DATETIME(3) NULL,
    `photo_copy_at` DATETIME(3) NULL,
    `started_from_studio_remarks` TEXT NULL,
    `reached_shoot_place_remarks` TEXT NULL,
    `pineapple_remarks` TEXT NULL,
    `shoot_started_remarks` TEXT NULL,
    `reached_studio_remarks` TEXT NULL,
    `shoot_status` VARCHAR(20) NULL,
    `shoot_status_remarks` TEXT NULL,
    `footage_url` VARCHAR(2048) NULL,
    `footage_backup_by_employee_id` INTEGER NULL,
    `footage_remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_production_shoot_id_key`(`shoot_id`),
    INDEX `project_production_sales_project_id_idx`(`sales_project_id`),
    INDEX `project_production_branch_id_idx`(`branch_id`),
    INDEX `project_production_production_coordinator_employee_id_idx`(`production_coordinator_employee_id`),
    INDEX `project_production_footage_backup_by_employee_id_idx`(`footage_backup_by_employee_id`),
    INDEX `project_production_plan_submitted_by_user_id_idx`(`plan_submitted_by_user_id`),
    INDEX `project_production_current_step_idx`(`current_step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_team_member` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `employee_id` INTEGER NULL,
    `vendor_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_production_team_member_production_id_employee_id_key`(`production_id`, `employee_id`),
    UNIQUE INDEX `project_production_team_member_production_id_vendor_id_key`(`production_id`, `vendor_id`),
    INDEX `project_production_team_member_employee_id_idx`(`employee_id`),
    INDEX `project_production_team_member_vendor_id_idx`(`vendor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_service_crew` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `service_definition_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `employee_id` INTEGER NULL,
    `vendor_id` INTEGER NULL,
    `camera_asset_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_production_service_crew_production_id_service_defini_key`(`production_id`, `service_definition_id`, `role`),
    INDEX `project_production_service_crew_service_definition_id_idx`(`service_definition_id`),
    INDEX `project_production_service_crew_employee_id_idx`(`employee_id`),
    INDEX `project_production_service_crew_vendor_id_idx`(`vendor_id`),
    INDEX `project_production_service_crew_camera_asset_id_idx`(`camera_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_file` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `url` MEDIUMTEXT NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NULL,
    `uploaded_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_production_file_production_id_kind_idx`(`production_id`, `kind`),
    INDEX `project_production_file_uploaded_by_user_id_idx`(`uploaded_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `production_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `detail` TEXT NULL,
    `user_id` INTEGER NULL,
    `user_name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_production_activity_production_id_created_at_idx`(`production_id`, `created_at`),
    INDEX `project_production_activity_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_message` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `step` VARCHAR(30) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `error` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `sent_from_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_production_message_production_id_step_key`(`production_id`, `step`),
    INDEX `project_production_message_sent_from_user_id_idx`(`sent_from_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_whatsapp_group_linked_by_user_id_fkey` FOREIGN KEY (`whatsapp_group_linked_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_sales_project_id_fkey` FOREIGN KEY (`sales_project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_production_coordinator_employee_id_fkey` FOREIGN KEY (`production_coordinator_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_footage_backup_by_employee_id_fkey` FOREIGN KEY (`footage_backup_by_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_plan_submitted_by_user_id_fkey` FOREIGN KEY (`plan_submitted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_team_member` ADD CONSTRAINT `project_production_team_member_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_team_member` ADD CONSTRAINT `project_production_team_member_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_team_member` ADD CONSTRAINT `project_production_team_member_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew` ADD CONSTRAINT `project_production_service_crew_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew` ADD CONSTRAINT `project_production_service_crew_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew` ADD CONSTRAINT `project_production_service_crew_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew` ADD CONSTRAINT `project_production_service_crew_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew` ADD CONSTRAINT `project_production_service_crew_camera_asset_id_fkey` FOREIGN KEY (`camera_asset_id`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_file` ADD CONSTRAINT `project_production_file_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_file` ADD CONSTRAINT `project_production_file_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_activity` ADD CONSTRAINT `project_production_activity_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_activity` ADD CONSTRAINT `project_production_activity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_message` ADD CONSTRAINT `project_production_message_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_message` ADD CONSTRAINT `project_production_message_sent_from_user_id_fkey` FOREIGN KEY (`sent_from_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The three production messages, as starting wording the studio edits in Settings → Templates.
-- `WHERE NOT EXISTS` so a studio that already wrote one keeps it, and a replay loses nothing.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_STARTED_FROM_STUDIO', 'Production — Started From Studio', 'Hi, our team has started from the studio for {shoot} on {date}.
Project: {project name}
Location: {location}
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_STARTED_FROM_STUDIO');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_REACHED_SHOOT_PLACE', 'Production — Reached Shoot Place', 'Hi, our team has reached {location} for {shoot} ({date}).
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_REACHED_SHOOT_PLACE');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_SHOOT_COMPLETED', 'Production — Shoot Completed', 'Hi, {shoot} for {project name} on {date} is complete. Thank you!
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_SHOOT_COMPLETED');
