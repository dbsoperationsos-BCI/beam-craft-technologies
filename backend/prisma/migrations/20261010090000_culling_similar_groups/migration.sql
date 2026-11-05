-- Culling V2: visually similar series (the same set-up or pose, from the scene engine's CLIP image
-- embedding) as a third kind of group beside duplicates and bursts. Additive and nullable: existing
-- rows are in no similar group until a run regroups them.
ALTER TABLE `image_selection_culling_result`
  ADD COLUMN `similar_group_id` VARCHAR(191) NULL,
  ADD COLUMN `similar_rank` INTEGER NULL,
  ADD INDEX `image_selection_culling_result_similar_group_id_idx`(`similar_group_id`);

ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_similar_group_id_fkey`
  FOREIGN KEY (`similar_group_id`) REFERENCES `image_selection_culling_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
