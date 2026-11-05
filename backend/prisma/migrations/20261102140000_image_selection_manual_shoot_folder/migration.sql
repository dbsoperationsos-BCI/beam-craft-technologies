-- A manual Photo Selection project's selection items are filed under a shoot group, and that group
-- IS one of the project's root folders. Until now the two were tied only by name ("wedding" items
-- belonged to the folder called "wedding"), so renaming the folder split one shoot into two and its
-- photos left their items. The items now point at the folder by id; the typed name stays as a copy.

ALTER TABLE `image_selection_deliverable_config`
    ADD COLUMN `manual_shoot_folder_id` VARCHAR(191) NULL,
    ADD INDEX `image_selection_deliverable_config_manual_shoot_folder_id_idx`(`manual_shoot_folder_id`);

ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_manual_shoot_folder_id_fkey`
    FOREIGN KEY (`manual_shoot_folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The link the screens were already making by name, written down once: a typed item on a manual
-- project goes to the active root folder of the same project whose name matches by the same rule
-- (`lib/shootGroups.mjs`: lower case, letters and digits only). Where two folders would match, the
-- first in the folder pane's order takes it. An item no folder matches is left unlinked, exactly as
-- it shows today, and is linked the day a folder of that name exists.
UPDATE `image_selection_deliverable_config` AS `item`
JOIN `image_selection_project` AS `project`
  ON `project`.`id` = `item`.`image_selection_project_id` AND `project`.`sales_project_id` IS NULL
SET `item`.`manual_shoot_folder_id` = (
  SELECT `folder`.`id` FROM `image_selection_folder` AS `folder`
  WHERE `folder`.`project_id` = `item`.`image_selection_project_id`
    AND `folder`.`parent_id` IS NULL
    AND `folder`.`deleted_at` IS NULL
    AND REGEXP_REPLACE(LOWER(`folder`.`name`), '[^a-z0-9]', '') <> ''
    AND REGEXP_REPLACE(LOWER(`folder`.`name`), '[^a-z0-9]', '') = REGEXP_REPLACE(LOWER(`item`.`manual_shoot_name`), '[^a-z0-9]', '')
  ORDER BY `folder`.`sort_order` ASC, `folder`.`created_at` ASC
  LIMIT 1
)
WHERE `item`.`manual_shoot_name` IS NOT NULL
  AND `item`.`project_post_production_allocation_id` IS NULL
  AND `item`.`project_shoot_deliverable_id` IS NULL;
