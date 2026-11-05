-- CreateTable
CREATE TABLE `client_notification` (
    `id` VARCHAR(191) NOT NULL,
    `sales_project_id` VARCHAR(191) NULL,
    `user_id` INTEGER NULL,
    `type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_notification_sales_project_id_created_at_idx`(`sales_project_id`, `created_at`),
    INDEX `client_notification_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_notification` ADD CONSTRAINT `client_notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
