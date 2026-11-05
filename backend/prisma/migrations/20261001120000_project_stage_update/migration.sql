-- CreateTable
CREATE TABLE `project_stage_update` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(30) NOT NULL,
    `remark` TEXT NOT NULL,
    `user_id` INTEGER NULL,
    `user_name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_stage_update_project_id_created_at_idx`(`project_id`, `created_at`),
    INDEX `project_stage_update_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_stage_update` ADD CONSTRAINT `project_stage_update_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stage_update` ADD CONSTRAINT `project_stage_update_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
