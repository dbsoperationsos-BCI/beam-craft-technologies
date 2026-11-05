-- AI culling, phase 4 of V2: who is in the photo, and how much they matter.
--
-- The People filter's clusters are the identity layer; a photographer may now label a person's
-- role (PRIMARY / FAMILY / IMPORTANT / BACKGROUND — generic, so any shoot fits; null lets the
-- photographs decide by frequency). Each culling result records the people it holds, the subject
-- the frame is about, a subject score the ranking reads, and the per-face details the face stage
-- saw (boxes and eye claims), so a later stage can weigh a blink by who blinked.
-- All additive; a project that never labels anyone behaves exactly as before.
ALTER TABLE `image_selection_face_person` ADD COLUMN `role` VARCHAR(30) NULL;

ALTER TABLE `image_selection_culling_result`
  ADD COLUMN `subject_score` DOUBLE NULL,
  ADD COLUMN `people_count` INTEGER NULL,
  ADD COLUMN `subject_person_id` VARCHAR(191) NULL,
  ADD COLUMN `face_details` JSON NULL;
CREATE INDEX `image_selection_culling_result_subject_person_id_idx`
  ON `image_selection_culling_result`(`subject_person_id`);
-- SET NULL: a person the People filter merges away or deletes leaves the result's score in place.
ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_subject_person_id_fkey`
  FOREIGN KEY (`subject_person_id`) REFERENCES `image_selection_face_person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
