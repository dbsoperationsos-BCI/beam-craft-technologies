-- Signature Album: photos uploaded to one album directly.
--
-- `signature_album_photo` is the album's own library - two web derivatives in R2 per photo, never an
-- `image_selection_upload`, so Photo Selection, the client gallery, faces and the project counts
-- never see it. An item now shows either a project photo (`image_id`) or one of these
-- (`album_photo_id`); existing items all keep their `image_id`, so nothing is rewritten. Additive:
-- a new table, one new nullable column, and `image_id` relaxed to NULL.

-- AlterTable
ALTER TABLE `signature_album_item` ADD COLUMN `album_photo_id` VARCHAR(191) NULL,
    MODIFY `image_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `signature_album_photo` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `thumbnail_key` VARCHAR(1024) NOT NULL,
    `preview_key` VARCHAR(1024) NOT NULL,
    `preview_bytes` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signature_album_photo_album_id_created_at_idx`(`album_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `signature_album_item_album_photo_id_idx` ON `signature_album_item`(`album_photo_id`);

-- CreateIndex
CREATE UNIQUE INDEX `signature_album_item_album_photo_unique` ON `signature_album_item`(`album_id`, `album_photo_id`);

-- AddForeignKey
ALTER TABLE `signature_album_item` ADD CONSTRAINT `signature_album_item_album_photo_id_fkey` FOREIGN KEY (`album_photo_id`) REFERENCES `signature_album_photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_photo` ADD CONSTRAINT `signature_album_photo_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `signature_album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

