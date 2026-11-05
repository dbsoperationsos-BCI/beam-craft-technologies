-- How long somebody may sit still before the application stops counting them as using it.
--
-- One row, keyed "default", the same idiom as `image_selection_settings` and
-- `sales_quotation_settings`. It was a constant in the browser bundle - changing it meant a deploy,
-- and until every tab was reloaded they disagreed with each other about what "in use" meant.
--
-- Seeded here rather than left to the first write, so a fresh install and an upgraded one answer
-- the same thing and the read path never has to invent a row.
CREATE TABLE `app_monitoring_settings` (
  `id` VARCHAR(30) NOT NULL DEFAULT 'default',
  `usage_timeout_minutes` INTEGER NOT NULL DEFAULT 3,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `app_monitoring_settings` (`id`, `usage_timeout_minutes`) VALUES ('default', 3);
