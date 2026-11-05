-- Similarity v2: the structure signature beside the perceptual hash, and a rank inside each of
-- the two group types. Additive and nullable; rows from earlier runs keep NULL and are never
-- re-interpreted.
ALTER TABLE `image_selection_culling_result` ADD COLUMN `structure_signature` VARCHAR(64) NULL;
ALTER TABLE `image_selection_culling_result` ADD COLUMN `duplicate_rank` INTEGER NULL;
ALTER TABLE `image_selection_culling_result` ADD COLUMN `burst_rank` INTEGER NULL;
