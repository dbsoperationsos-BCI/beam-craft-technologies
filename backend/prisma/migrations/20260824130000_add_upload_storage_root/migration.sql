-- Which named storage root a desktop-registered photo's `original_path` is relative to. Null for
-- every photo from the older flows (browser trails, server-side registration, chunk uploads).
-- SET NULL on delete mirrors the soft-delete story: a retired root's photos keep their trail and
-- lose only the pointer.
ALTER TABLE `image_selection_upload` ADD COLUMN `storage_root_id` VARCHAR(191) NULL;

ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_storage_root_id_fkey`
  FOREIGN KEY (`storage_root_id`) REFERENCES `image_selection_storage_root`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

