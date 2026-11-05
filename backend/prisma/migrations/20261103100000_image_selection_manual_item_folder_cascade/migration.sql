-- A manual project's selection item belongs to its root folder by id. Deleting the folder must take
-- the item with it, so the database now guarantees it: no path can leave an item behind whose
-- folder is gone (SET NULL used to turn such an item into a shoot with no folder).

-- Items written before items were linked by id, whose folder had already been renamed or deleted by
-- then, were left unlinked by 20261102140000 and no folder delete can reach them. Those no folder
-- matches and the client never picked against are removed; one with picks is kept, untouched.
DELETE `item` FROM `image_selection_deliverable_config` AS `item`
JOIN `image_selection_project` AS `project`
  ON `project`.`id` = `item`.`image_selection_project_id` AND `project`.`sales_project_id` IS NULL
WHERE `item`.`manual_shoot_folder_id` IS NULL
  AND `item`.`manual_shoot_name` IS NOT NULL
  AND `item`.`project_post_production_allocation_id` IS NULL
  AND `item`.`project_shoot_deliverable_id` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `image_selection_photo_selection` AS `pick`
    WHERE `pick`.`image_selection_deliverable_config_id` = `item`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `image_selection_folder` AS `folder`
    WHERE `folder`.`project_id` = `item`.`image_selection_project_id`
      AND `folder`.`parent_id` IS NULL
      AND `folder`.`deleted_at` IS NULL
      AND REGEXP_REPLACE(LOWER(`folder`.`name`), '[^a-z0-9]', '') = REGEXP_REPLACE(LOWER(`item`.`manual_shoot_name`), '[^a-z0-9]', '')
  );

ALTER TABLE `image_selection_deliverable_config` DROP FOREIGN KEY `image_selection_deliverable_config_manual_shoot_folder_id_fkey`;

ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_manual_shoot_folder_id_fkey`
    FOREIGN KEY (`manual_shoot_folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
