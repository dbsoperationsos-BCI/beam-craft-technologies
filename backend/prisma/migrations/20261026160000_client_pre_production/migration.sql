-- AlterTable
ALTER TABLE `project_pre_production` ADD COLUMN `client_form_sent_at` DATETIME(3) NULL,
    ADD COLUMN `client_answered` JSON NULL;

-- CreateTable
CREATE TABLE `project_pre_production_image` (
    `id` VARCHAR(191) NOT NULL,
    `pre_production_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `url` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_pre_production_image_pre_production_id_kind_idx`(`pre_production_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_pre_production_image` ADD CONSTRAINT `project_pre_production_image_pre_production_id_fkey` FOREIGN KEY (`pre_production_id`) REFERENCES `project_pre_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
