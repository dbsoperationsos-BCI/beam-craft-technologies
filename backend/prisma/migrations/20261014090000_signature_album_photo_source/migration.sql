-- AI Culling -> Send Photos -> Signature Album, from the desktop: the workstation compresses a Keep's
-- original with the album's own preset and uploads only the two derivatives. `source_upload_id`
-- names the project photo the copy was made from, so a retried or repeated send answers with the
-- copy already in the album instead of storing a second one. Nullable: every existing album photo
-- (a direct upload, an AI edit) has no source and keeps none. Additive only - no row is rewritten.

ALTER TABLE `signature_album_photo` ADD COLUMN `source_upload_id` VARCHAR(191) NULL;

-- One copy per project photo per album. MySQL lets any number of NULLs through a unique index, so
-- photos with no source are unaffected.
CREATE UNIQUE INDEX `signature_album_photo_album_id_source_upload_id_key` ON `signature_album_photo`(`album_id`, `source_upload_id`);
CREATE INDEX `signature_album_photo_source_upload_id_idx` ON `signature_album_photo`(`source_upload_id`);

-- The project photo going away leaves the album's copy in place (the studio placed it), unlinked.
ALTER TABLE `signature_album_photo` ADD CONSTRAINT `signature_album_photo_source_upload_id_fkey` FOREIGN KEY (`source_upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
