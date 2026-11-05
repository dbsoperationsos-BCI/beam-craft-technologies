-- One continuous stretch of somebody actually using the application.
--
-- The usage reports inferred time on task from the gaps between recorded lead actions, which
-- answers a different question from the one the studio asks: twelve minutes spent in another
-- application between two saved leads was counted as work here. This table is what replaces that
-- guess with a measurement - the browser beats while the tab is visible and the person has
-- interacted recently, each beat extending the open stretch.
CREATE TABLE `app_usage_session` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `context` VARCHAR(30) NOT NULL DEFAULT 'app',
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `app_usage_session_user_id_context_ended_at_idx`(`user_id`, `context`, `ended_at`),
  INDEX `app_usage_session_ended_at_idx`(`ended_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
