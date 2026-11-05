-- Add Asset: Subcategory "Others" and the text typed for it. Nullable, no backfill: every existing
-- asset has a listed subcategory.
ALTER TABLE `asset` ADD COLUMN `sub_category_other` VARCHAR(191) NULL;
