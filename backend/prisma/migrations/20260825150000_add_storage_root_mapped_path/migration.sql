-- Where a storage root is mounted, stored on the root's own row instead of in the desktop app's
-- local settings, so the mapping survives reinstalls and is visible wherever the root is listed.
ALTER TABLE `image_selection_storage_root` ADD COLUMN `mapped_path` VARCHAR(1024) NULL;
