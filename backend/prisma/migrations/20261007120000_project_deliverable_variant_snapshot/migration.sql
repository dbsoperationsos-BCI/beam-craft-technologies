-- A project's deliverable line remembers which variant of the deliverable it is.
--
-- A deliverable is sold by brands in variants - Painting by textra in 12x6 and 12x8, by Canvera in
-- the same two - and a quotation line already keeps the variant it was priced as. The project line
-- raised from it kept only the deliverable, so "Painting - textra - 12x6 - 2" arrived as
-- "Painting", and two variants of one deliverable on one shoot could not both arrive at all.
--
-- These hold the variant as it read when the line was added: the brand's name, the size and the
-- frame of an image, the length of a video (`size` already existed and was never written). A
-- snapshot rather than a key, because a variant can be resized, repriced or removed in Settings
-- after the sale, and the line has to go on saying what was sold - the same reason the quotation
-- keeps its own copy.
--
-- Nullable and additive: every line already saved reads exactly as it did, by its deliverable's
-- name. Adding nullable columns touches no row, so this is safe to replay.
ALTER TABLE `project_shoot_deliverable`
  ADD COLUMN `brand_name` VARCHAR(191) NULL,
  ADD COLUMN `frame_inches` VARCHAR(60) NULL,
  ADD COLUMN `video_length` VARCHAR(100) NULL;
