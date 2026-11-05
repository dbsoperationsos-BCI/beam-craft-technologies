-- The IDs a booking and its shoots carried in the studio's old spreadsheet, kept beside the app's own
-- so Pre Production → Import can find a project or shoot again when the same file is uploaded twice
-- rather than creating it a second time. Both nullable: everything made in the app has none.
--
-- Cost: two nullable columns and two unique indexes on tables of a few thousand rows. Instant.

ALTER TABLE `sales_project` ADD COLUMN `sheet_event_id` VARCHAR(30) NULL;
CREATE UNIQUE INDEX `sales_project_sheet_event_id_key` ON `sales_project`(`sheet_event_id`);

ALTER TABLE `project_shoot` ADD COLUMN `sheet_shoot_id` VARCHAR(30) NULL;
CREATE UNIQUE INDEX `project_shoot_sheet_shoot_id_key` ON `project_shoot`(`sheet_shoot_id`);
