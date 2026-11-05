-- Phase 6: scene, aesthetic and composition. Additive only.

-- What the scene engine said about one photo, per engine version: a photo is embedded once and
-- every later run (any scope, any mode) reads it from here. Goes with the photo.
CREATE TABLE `image_selection_upload_scene` (
  `id` VARCHAR(191) NOT NULL,
  `upload_id` VARCHAR(191) NOT NULL,
  `engine_version` VARCHAR(80) NOT NULL,
  `scene_label` VARCHAR(30) NULL,
  `scene_confidence` DOUBLE NULL,
  `accidental` BOOLEAN NOT NULL DEFAULT false,
  `aesthetic_raw` DOUBLE NULL,
  `embedding` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `image_selection_upload_scene_upload_id_engine_version_key`(`upload_id`, `engine_version`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_upload_scene` ADD CONSTRAINT `image_selection_upload_scene_upload_id_fkey`
  FOREIGN KEY (`upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The run's reading of it, on the result row. (`aesthetic_score` already exists from the first
-- culling migration and is filled from now on.)
ALTER TABLE `image_selection_culling_result`
  ADD COLUMN `scene_label` VARCHAR(30) NULL,
  ADD COLUMN `scene_confidence` DOUBLE NULL,
  ADD COLUMN `composition_score` DOUBLE NULL;

CREATE INDEX `image_selection_culling_result_session_id_scene_label_idx` ON `image_selection_culling_result`(`session_id`, `scene_label`);
