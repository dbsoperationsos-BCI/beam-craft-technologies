-- Culling V2: a photo's own quality kept apart from its group rank and the photographer's taste,
-- and the local face engine's face sharpness, head pose and expression. Additive and nullable:
-- every existing result row keeps its values, and a run that does not produce a signal leaves it null.
ALTER TABLE `image_selection_culling_result`
  ADD COLUMN `quality_score` DOUBLE NULL,
  ADD COLUMN `preference_adjustment` DOUBLE NULL,
  ADD COLUMN `face_sharpness_score` DOUBLE NULL,
  ADD COLUMN `head_pose_score` DOUBLE NULL,
  ADD COLUMN `expression_label` VARCHAR(20) NULL;
