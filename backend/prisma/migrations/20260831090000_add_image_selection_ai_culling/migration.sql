-- AI Photo Culling: the staff-facing triage that runs before Photo Selection. Four new tables,
-- nothing existing altered. A culling session is one AI run over a project's processed photos;
-- results annotate the existing image_selection_upload rows (which stay the master photo record),
-- groups cluster duplicates/bursts, and feedback keeps every photographer override as history.
-- No photo bytes are stored here and nothing is ever deleted by the engine — a REJECT only hides
-- a photo from Photo Selection after the photographer finalizes a session.

CREATE TABLE `image_selection_culling_session` (
  `id` VARCHAR(191) NOT NULL,
  `project_id` VARCHAR(191) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  `mode` VARCHAR(30) NOT NULL DEFAULT 'ASSISTED',
  `target_count` INTEGER NULL,
  `total_images` INTEGER NOT NULL DEFAULT 0,
  `processed_images` INTEGER NOT NULL DEFAULT 0,
  `keep_count` INTEGER NOT NULL DEFAULT 0,
  `maybe_count` INTEGER NOT NULL DEFAULT 0,
  `reject_count` INTEGER NOT NULL DEFAULT 0,
  `current_stage` VARCHAR(30) NULL,
  `progress_percent` INTEGER NOT NULL DEFAULT 0,
  `engine_version` VARCHAR(30) NULL,
  `scoring_profile_version` VARCHAR(30) NULL,
  `provider_request_count` INTEGER NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `finalized_at` DATETIME(3) NULL,
  `created_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `image_selection_culling_session_project_id_status_idx`(`project_id`, `status`),
  INDEX `image_selection_culling_session_project_id_created_at_idx`(`project_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `image_selection_culling_result` (
  `id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `upload_id` VARCHAR(191) NOT NULL,
  `blur_score` DOUBLE NULL,
  `exposure_score` DOUBLE NULL,
  `technical_score` DOUBLE NULL,
  `face_count` INTEGER NULL,
  `face_quality_score` DOUBLE NULL,
  `eyes_open_score` DOUBLE NULL,
  `expression_score` DOUBLE NULL,
  `similarity_score` DOUBLE NULL,
  `aesthetic_score` DOUBLE NULL,
  `uniqueness_score` DOUBLE NULL,
  `final_score` DOUBLE NULL,
  `duplicate_group_id` VARCHAR(191) NULL,
  `burst_group_id` VARCHAR(191) NULL,
  `is_group_best` BOOLEAN NOT NULL DEFAULT false,
  `ai_decision` VARCHAR(20) NULL,
  `user_decision` VARCHAR(20) NULL,
  `effective_decision` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `confidence` DOUBLE NULL,
  `reason_codes` JSON NULL,
  `analyzed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `image_selection_culling_result_session_upload_unique`(`session_id`, `upload_id`),
  -- Named by hand: the generated name lands exactly on MySQL's 64-character identifier limit.
  INDEX `image_selection_culling_result_session_decision_idx`(`session_id`, `effective_decision`),
  INDEX `image_selection_culling_result_upload_id_idx`(`upload_id`),
  INDEX `image_selection_culling_result_duplicate_group_id_idx`(`duplicate_group_id`),
  INDEX `image_selection_culling_result_burst_group_id_idx`(`burst_group_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `image_selection_culling_group` (
  `id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `representative_upload_id` VARCHAR(191) NULL,
  `member_count` INTEGER NOT NULL DEFAULT 0,
  `group_score` DOUBLE NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `image_selection_culling_group_session_id_type_idx`(`session_id`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `image_selection_culling_feedback` (
  `id` VARCHAR(191) NOT NULL,
  `result_id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NULL,
  `previous_decision` VARCHAR(20) NULL,
  `new_decision` VARCHAR(20) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `image_selection_culling_feedback_result_id_created_at_idx`(`result_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_culling_session` ADD CONSTRAINT `image_selection_culling_session_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_session_id_fkey`
  FOREIGN KEY (`session_id`) REFERENCES `image_selection_culling_session`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_upload_id_fkey`
  FOREIGN KEY (`upload_id`) REFERENCES `image_selection_upload`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_duplicate_group_id_fkey`
  FOREIGN KEY (`duplicate_group_id`) REFERENCES `image_selection_culling_group`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_result` ADD CONSTRAINT `image_selection_culling_result_burst_group_id_fkey`
  FOREIGN KEY (`burst_group_id`) REFERENCES `image_selection_culling_group`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_group` ADD CONSTRAINT `image_selection_culling_group_session_id_fkey`
  FOREIGN KEY (`session_id`) REFERENCES `image_selection_culling_session`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_selection_culling_feedback` ADD CONSTRAINT `image_selection_culling_feedback_result_id_fkey`
  FOREIGN KEY (`result_id`) REFERENCES `image_selection_culling_result`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
