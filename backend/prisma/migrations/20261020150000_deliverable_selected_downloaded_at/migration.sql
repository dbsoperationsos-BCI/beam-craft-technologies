-- Image Selection: when each selection item's submitted picks were last copied out, so a download
-- of Retouches no longer clears Frames from Yet to Download. Filled from the project's own stamp for
-- every item submitted on or before it, so nothing already downloaded reappears.
--
-- Cost: one nullable column and one backfill over the selection items (thousands at most). Seconds.

ALTER TABLE `image_selection_deliverable_config` ADD COLUMN `selected_downloaded_at` DATETIME(3) NULL;

UPDATE `image_selection_deliverable_config` AS `item`
  JOIN `image_selection_project` AS `project` ON `project`.`id` = `item`.`image_selection_project_id`
   SET `item`.`selected_downloaded_at` = `project`.`selected_downloaded_at`
 WHERE `project`.`selected_downloaded_at` IS NOT NULL
   AND `item`.`selection_submitted_at` IS NOT NULL
   AND `item`.`selection_submitted_at` <= `project`.`selected_downloaded_at`;
