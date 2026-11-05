-- HRM → Events: several photos per event, taken with the camera or uploaded.
--
-- A table of its own rather than a list in one column: each photo has its own bucket key to remove
-- when the event goes, and its own place in the order. `hrm_event.image_url` stays as the cover -
-- the first photo - so a card is drawn without reading the list, and nothing that reads the cover
-- has to change.
--
-- Every event posted before this had exactly one photo, its cover, which is copied in as the first
-- (and only) row of its list, so old and new events read the same way.

CREATE TABLE `hrm_event_image` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `event_id` INTEGER NOT NULL,
  `image_url` MEDIUMTEXT NOT NULL,
  `image_key` VARCHAR(255) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `hrm_event_image_event_id_sort_order_idx`(`event_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hrm_event_image` ADD CONSTRAINT `hrm_event_image_event_id_fkey`
  FOREIGN KEY (`event_id`) REFERENCES `hrm_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `hrm_event_image` (`event_id`, `image_url`, `image_key`, `sort_order`, `created_at`)
SELECT `event`.`id`, `event`.`image_url`, `event`.`image_key`, 0, `event`.`created_at`
  FROM `hrm_event` AS `event`
 WHERE NOT EXISTS (SELECT 1 FROM `hrm_event_image` AS `existing` WHERE `existing`.`event_id` = `event`.`id`);
