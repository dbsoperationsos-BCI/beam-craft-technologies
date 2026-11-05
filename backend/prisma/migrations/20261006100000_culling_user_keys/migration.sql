-- Rule 5: who changed a culling decision and who started a run are user ids with a key.
-- A deleted user leaves the rows in place without a name (ON DELETE SET NULL).

-- Ids that name no user (a user deleted before the key existed) are cleared first, so the keys
-- below cannot fail on production data.
UPDATE `image_selection_culling_feedback` AS `f`
  SET `f`.`user_id` = NULL
  WHERE `f`.`user_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `user` AS `u` WHERE `u`.`id` = `f`.`user_id`);

UPDATE `image_selection_culling_session` AS `s`
  SET `s`.`created_by_user_id` = NULL
  WHERE `s`.`created_by_user_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `user` AS `u` WHERE `u`.`id` = `s`.`created_by_user_id`);

-- The feedback key is served by image_selection_culling_feedback_user_id_created_at_idx.
CREATE INDEX `image_selection_culling_session_created_by_user_id_idx` ON `image_selection_culling_session`(`created_by_user_id`);

ALTER TABLE `image_selection_culling_feedback`
  ADD CONSTRAINT `image_selection_culling_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_session`
  ADD CONSTRAINT `image_selection_culling_session_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
