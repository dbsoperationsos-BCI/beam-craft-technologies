-- The shoot group a typed selection item was filed under — "Pre Wedding", "Wedding" — typed
-- alongside it in Selection Settings on a manually named project. NULL on allocation-derived
-- rows, whose shoot is the deliverable's, and on typed items from before groups existed.
ALTER TABLE `image_selection_deliverable_config` ADD COLUMN `manual_shoot_name` VARCHAR(191) NULL;
