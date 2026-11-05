-- Photo Selling: a guest who leaves their name and WhatsApp number before the selfie search, and
-- agrees to be told, is told on WhatsApp when photos the studio uploads later match them. Approved by
-- the owner on 2026-10-29. Everything is new and empty: no existing row is read or changed, and the
-- two switches default to what the store did before (selfie search on, WhatsApp off).

-- AlterTable
ALTER TABLE `photo_sale_gallery`
    ADD COLUMN `selfie_search_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsapp_notify` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `photo_sale_setting`
    ADD COLUMN `selfie_search_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whatsapp_notify` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `photo_sale_guest` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `session_hash` CHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `whatsapp_opt_in_at` DATETIME(3) NULL,
    `whatsapp_opt_out_at` DATETIME(3) NULL,
    `face_engine` VARCHAR(20) NULL,
    `face_dimension` INTEGER NULL,
    `face_vector` TEXT NULL,
    `face_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `photo_sale_guest_gallery_id_session_hash_key`(`gallery_id`, `session_hash`),
    INDEX `photo_sale_guest_gallery_id_face_at_idx`(`gallery_id`, `face_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_notification` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `match_count` INTEGER NOT NULL DEFAULT 0,
    `recipient_masked` VARCHAR(40) NULL,
    `template` VARCHAR(191) NULL,
    `provider` VARCHAR(20) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(80) NULL,
    `error_message` VARCHAR(500) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `photo_sale_notification_gallery_id_status_idx`(`gallery_id`, `status`),
    INDEX `photo_sale_notification_status_updated_at_idx`(`status`, `updated_at`),
    INDEX `photo_sale_notification_guest_id_idx`(`guest_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_guest_match` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `photo_id` VARCHAR(191) NOT NULL,
    `score` DOUBLE NOT NULL,
    `source` VARCHAR(12) NOT NULL,
    `notification_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `photo_sale_guest_match_guest_id_photo_id_key`(`guest_id`, `photo_id`),
    INDEX `photo_sale_guest_match_gallery_id_source_notification_id_idx`(`gallery_id`, `source`, `notification_id`),
    INDEX `photo_sale_guest_match_photo_id_idx`(`photo_id`),
    INDEX `photo_sale_guest_match_notification_id_idx`(`notification_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `photo_sale_guest` ADD CONSTRAINT `photo_sale_guest_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_notification` ADD CONSTRAINT `photo_sale_notification_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_notification` ADD CONSTRAINT `photo_sale_notification_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `photo_sale_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_match` ADD CONSTRAINT `photo_sale_guest_match_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_match` ADD CONSTRAINT `photo_sale_guest_match_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `photo_sale_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_match` ADD CONSTRAINT `photo_sale_guest_match_photo_id_fkey` FOREIGN KEY (`photo_id`) REFERENCES `photo_sale_photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_match` ADD CONSTRAINT `photo_sale_guest_match_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `photo_sale_notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
