-- Culling learning layer (phases 1, 8, 9): additive only. Nothing existing changes shape, and
-- nothing here is read by a culling run unless the learning switches are turned on.
--
-- 1. image_selection_culling_decision_event: one row per photographer action on a run - how a
--    decision was made (a key, a click, the preview panel, a bulk action), a best-of-group change
--    with the group's new order, and sampled "seen on screen" marks. The training labels' quality
--    is read from it, and which app (web or desktop) the review happened in. Append-only.
-- 2. image_selection_culling_model: the model registry. A learned ranker bundle is a candidate,
--    shadow, canary, production or retired; its artifact is checksummed on disk.
-- 3. image_selection_culling_shadow_result: what a shadow model would have said about each photo
--    of a run. Never shown, never counted, never used to decide.
-- 4. image_selection_settings.culling_training_consent: the studio's opt-in to its finalized runs
--    being exported for training. Off by default; the export refuses without it. Who last changed
--    it, and when, is kept beside it.

CREATE TABLE `image_selection_culling_decision_event` (
  `id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `result_id` VARCHAR(191) NULL,
  `group_id` VARCHAR(191) NULL,
  `user_id` INTEGER NULL,
  `kind` VARCHAR(20) NOT NULL,
  `from_decision` VARCHAR(20) NULL,
  `to_decision` VARCHAR(20) NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  `platform` VARCHAR(10) NOT NULL DEFAULT 'WEB',
  `batch_size` INTEGER NOT NULL DEFAULT 1,
  `group_order` JSON NULL,
  `ms_since_previous` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `image_selection_culling_decision_event_session_id_created_at_idx`(`session_id`, `created_at`),
  INDEX `image_selection_culling_decision_event_result_id_idx`(`result_id`),
  INDEX `image_selection_culling_decision_event_group_id_idx`(`group_id`),
  INDEX `image_selection_culling_decision_event_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_culling_decision_event`
  ADD CONSTRAINT `image_selection_culling_decision_event_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `image_selection_culling_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `image_selection_culling_decision_event_result_id_fkey` FOREIGN KEY (`result_id`) REFERENCES `image_selection_culling_result`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `image_selection_culling_decision_event_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `image_selection_culling_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `image_selection_culling_decision_event_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `image_selection_culling_model` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `version` VARCHAR(40) NOT NULL,
  `dataset_version` VARCHAR(80) NOT NULL,
  `feature_set_version` VARCHAR(40) NOT NULL,
  `engine_version` VARCHAR(40) NOT NULL,
  `artifact_path` VARCHAR(500) NOT NULL,
  `artifact_sha256` CHAR(64) NOT NULL,
  `artifact_bytes` INTEGER NOT NULL,
  `metrics` JSON NULL,
  `hyperparameters` JSON NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'CANDIDATE',
  `notes` TEXT NULL,
  `promoted_by_user_id` INTEGER NULL,
  `promoted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `image_selection_culling_model_name_version_key`(`name`, `version`),
  INDEX `image_selection_culling_model_status_idx`(`status`),
  INDEX `image_selection_culling_model_promoted_by_user_id_idx`(`promoted_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_culling_model`
  ADD CONSTRAINT `image_selection_culling_model_promoted_by_user_id_fkey` FOREIGN KEY (`promoted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `image_selection_culling_shadow_result` (
  `id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `result_id` VARCHAR(191) NOT NULL,
  `model_id` VARCHAR(191) NOT NULL,
  `score` DOUBLE NOT NULL,
  `decision` VARCHAR(20) NULL,
  `group_rank` INTEGER NULL,
  `is_group_best` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `image_selection_culling_shadow_result_unique`(`session_id`, `result_id`, `model_id`),
  INDEX `image_selection_culling_shadow_result_model_session_idx`(`model_id`, `session_id`),
  INDEX `image_selection_culling_shadow_result_result_id_idx`(`result_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_culling_shadow_result`
  ADD CONSTRAINT `image_selection_culling_shadow_result_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `image_selection_culling_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `image_selection_culling_shadow_result_result_id_fkey` FOREIGN KEY (`result_id`) REFERENCES `image_selection_culling_result`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `image_selection_culling_shadow_result_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `image_selection_culling_model`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `image_selection_settings`
  ADD COLUMN `culling_training_consent` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `culling_training_consent_at` DATETIME(3) NULL,
  ADD COLUMN `culling_training_consent_by_user_id` INTEGER NULL,
  ADD INDEX `image_selection_settings_culling_consent_by_user_id_idx`(`culling_training_consent_by_user_id`),
  ADD CONSTRAINT `image_selection_settings_culling_consent_by_user_id_fkey` FOREIGN KEY (`culling_training_consent_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
