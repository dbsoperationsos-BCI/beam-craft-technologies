-- Phase 8: photographer preferences. Additive only.

-- Each photographer's switch for learned preferences, and the point they last asked culling to
-- forget (overrides before it are not learned from). Goes with the user.
CREATE TABLE `image_selection_culling_preference` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `reset_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `image_selection_culling_preference_user_id_key`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_culling_preference` ADD CONSTRAINT `image_selection_culling_preference_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The learned profile a run used, snapshotted when it started: reproducible, never re-read.
ALTER TABLE `image_selection_culling_session` ADD COLUMN `preference_profile` JSON NULL;

-- The preference read filters one photographer's overrides and walks them newest first.
CREATE INDEX `image_selection_culling_feedback_user_id_created_at_idx` ON `image_selection_culling_feedback`(`user_id`, `created_at`);
