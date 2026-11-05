-- An Activity tab for a project on Projects and on Pre Production, as Production's shoots have.
--
-- Production logs every action on a shoot (`project_production_activity`); Projects and Pre Production
-- kept no log. Every change made from either is now written here - what was done, to which shoot if
-- one, by whom and when - and read back newest first. Nothing done before this is recorded.
--
-- Cost: one empty table. No data written.

-- CreateTable
CREATE TABLE `project_activity` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NULL,
    `area` VARCHAR(20) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `detail` TEXT NULL,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

INDEX `project_activity_project_id_area_created_at_idx`(`project_id`, `area`, `created_at`),
    INDEX `project_activity_shoot_id_idx`(`shoot_id`),
    INDEX `project_activity_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_activity` ADD CONSTRAINT `project_activity_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_activity` ADD CONSTRAINT `project_activity_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_activity` ADD CONSTRAINT `project_activity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
