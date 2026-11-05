-- Strict local original source: the file identity the desktop verifies before any local
-- analysis or edit, and why an edit could not be rendered from the original. Additive only.
ALTER TABLE `image_selection_upload` ADD COLUMN `source_checksum` VARCHAR(64) NULL;
ALTER TABLE `image_selection_edit` ADD COLUMN `error_code` VARCHAR(40) NULL;
