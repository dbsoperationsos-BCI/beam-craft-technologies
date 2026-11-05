-- Signature Album: a cover can be one of the album's own uploads.
--
-- The cover used to be only a project photo (`cover_image_id`). Covers are now chosen from the
-- album's uploads, so `cover_album_photo_id` points at `signature_album_photo`; a cover chosen
-- before keeps its `cover_image_id` and keeps drawing. Additive: one nullable column, its index and
-- key; no row is rewritten. Runs after 20260928100000, which creates `signature_album_photo`.

-- AlterTable
ALTER TABLE `signature_album` ADD COLUMN `cover_album_photo_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `signature_album_cover_album_photo_id_idx` ON `signature_album`(`cover_album_photo_id`);

-- AddForeignKey
ALTER TABLE `signature_album` ADD CONSTRAINT `signature_album_cover_album_photo_id_fkey` FOREIGN KEY (`cover_album_photo_id`) REFERENCES `signature_album_photo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

