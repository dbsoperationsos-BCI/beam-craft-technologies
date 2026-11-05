-- Photo Selling: a guest keeps up to ten selfies in a gallery, each searched with, each removable.
-- Approved by the owner on 2026-10-29. One new table, and a count on the guest that makes the limit
-- a single conditional UPDATE. The one face a consenting guest already had (photo_sale_guest.face_*)
-- is copied in as their first selfie; those columns stay, unread.

-- AlterTable
ALTER TABLE `photo_sale_guest` ADD COLUMN `selfie_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `photo_sale_guest_selfie` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `search_id` VARCHAR(191) NULL,
    `engine` VARCHAR(20) NOT NULL,
    `dimension` INTEGER NOT NULL,
    `vector` TEXT NOT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `photo_sale_guest_selfie_guest_id_idx`(`guest_id`),
    INDEX `photo_sale_guest_selfie_gallery_id_idx`(`gallery_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_selfie` ADD CONSTRAINT `photo_sale_guest_selfie_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_guest_selfie` ADD CONSTRAINT `photo_sale_guest_selfie_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `photo_sale_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The face a consenting guest already had becomes their first selfie (no thumbnail: none was kept).
INSERT INTO `photo_sale_guest_selfie` (`id`, `gallery_id`, `guest_id`, `engine`, `dimension`, `vector`, `created_at`)
SELECT UUID(), `gallery_id`, `id`, `face_engine`, `face_dimension`, `face_vector`, COALESCE(`face_at`, CURRENT_TIMESTAMP(3))
FROM `photo_sale_guest`
WHERE `face_vector` IS NOT NULL AND `face_engine` IS NOT NULL AND `face_dimension` IS NOT NULL;

UPDATE `photo_sale_guest` SET `selfie_count` = 1
WHERE `face_vector` IS NOT NULL AND `face_engine` IS NOT NULL AND `face_dimension` IS NOT NULL;
