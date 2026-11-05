-- Visual Curation module projects: AI Culling, AI Editing and Signature Album each get project
-- records of their own (own ID, name and client), created together from one Create Project form
-- and linked through the photo workspace they share (`image_selection_project`, which stays Photo
-- Selection's own project). The photos, culling runs, edits and album are untouched: they stay on
-- the workspace, so every send between modules works exactly as before.
--
-- Backfill: every manual project already in a module gets that module's record, so the module's
-- Projects page keeps listing it, now under its own ID - DBS-VCAC-000001 (AI Culling), DBS-VCAE-
-- (AI Editing), DBS-VCSA- (Signature Album), numbered in the order the projects were created. The
-- name and client are copied from the project. The rule for "in a module" is the workspace's own:
-- AI Culling and AI Editing unless explicitly unticked (null is on), Signature Album only when
-- ticked. Projects from Project Management (`sales_project_id`) take their modules from their
-- allocation and get no records; Album Proofing's projects are not Visual Curation's.
-- The three counters are then set to the numbers used, so new records carry on from there.
--
-- Cost: one small table and one row per module of each manual project. No existing row changes.

CREATE TABLE `visual_curation_module_project` (
  `id` VARCHAR(191) NOT NULL,
  `image_selection_project_id` VARCHAR(191) NOT NULL,
  `module` VARCHAR(20) NOT NULL,
  `project_code` VARCHAR(40) NOT NULL,
  `project_name` VARCHAR(500) NOT NULL,
  `client_name` VARCHAR(191) NULL,
  `client_main_number` VARCHAR(30) NULL,
  `created_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `visual_curation_module_project_project_code_key`(`project_code`),
  UNIQUE INDEX `vc_module_project_workspace_module_unique`(`image_selection_project_id`, `module`),
  INDEX `vc_module_project_module_idx`(`module`),
  INDEX `vc_module_project_created_by_user_id_idx`(`created_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `visual_curation_module_project` ADD CONSTRAINT `visual_curation_module_project_image_selection_project_id_fkey`
  FOREIGN KEY (`image_selection_project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `visual_curation_module_project` ADD CONSTRAINT `visual_curation_module_project_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AI Culling: on unless explicitly unticked.
INSERT INTO `visual_curation_module_project` (`id`, `image_selection_project_id`, `module`, `project_code`, `project_name`, `client_name`, `client_main_number`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT UUID(), `p`.`id`, 'culling', CONCAT('DBS-VCAC-', LPAD(ROW_NUMBER() OVER (ORDER BY `p`.`created_at`, `p`.`id`), 6, '0')),
       `p`.`project_name`, `p`.`client_name`, `p`.`client_main_number`, `p`.`created_by_user_id`, `p`.`created_at`, NOW(3)
  FROM `image_selection_project` AS `p`
 WHERE `p`.`deleted_at` IS NULL AND `p`.`album_proofing` = 0 AND `p`.`sales_project_id` IS NULL
   AND (`p`.`photo_culling_tab` IS NULL OR `p`.`photo_culling_tab` = 1);

-- AI Editing: on unless explicitly unticked.
INSERT INTO `visual_curation_module_project` (`id`, `image_selection_project_id`, `module`, `project_code`, `project_name`, `client_name`, `client_main_number`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT UUID(), `p`.`id`, 'editing', CONCAT('DBS-VCAE-', LPAD(ROW_NUMBER() OVER (ORDER BY `p`.`created_at`, `p`.`id`), 6, '0')),
       `p`.`project_name`, `p`.`client_name`, `p`.`client_main_number`, `p`.`created_by_user_id`, `p`.`created_at`, NOW(3)
  FROM `image_selection_project` AS `p`
 WHERE `p`.`deleted_at` IS NULL AND `p`.`album_proofing` = 0 AND `p`.`sales_project_id` IS NULL
   AND (`p`.`ai_editing_tab` IS NULL OR `p`.`ai_editing_tab` = 1);

-- Signature Album: only when ticked.
INSERT INTO `visual_curation_module_project` (`id`, `image_selection_project_id`, `module`, `project_code`, `project_name`, `client_name`, `client_main_number`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT UUID(), `p`.`id`, 'album', CONCAT('DBS-VCSA-', LPAD(ROW_NUMBER() OVER (ORDER BY `p`.`created_at`, `p`.`id`), 6, '0')),
       `p`.`project_name`, `p`.`client_name`, `p`.`client_main_number`, `p`.`created_by_user_id`, `p`.`created_at`, NOW(3)
  FROM `image_selection_project` AS `p`
 WHERE `p`.`deleted_at` IS NULL AND `p`.`album_proofing` = 0 AND `p`.`sales_project_id` IS NULL
   AND `p`.`signature_album_tab` = 1;

-- The counters carry on from the numbers the backfill used (`services/identifiers.js` keys).
INSERT INTO `app_sequence` (`key`, `current_value`, `created_at`, `updated_at`)
SELECT 'VC_AI_CULLING', COUNT(*), NOW(3), NOW(3) FROM `visual_curation_module_project` WHERE `module` = 'culling'
ON DUPLICATE KEY UPDATE `current_value` = GREATEST(`current_value`, VALUES(`current_value`)), `updated_at` = NOW(3);
INSERT INTO `app_sequence` (`key`, `current_value`, `created_at`, `updated_at`)
SELECT 'VC_AI_EDITING', COUNT(*), NOW(3), NOW(3) FROM `visual_curation_module_project` WHERE `module` = 'editing'
ON DUPLICATE KEY UPDATE `current_value` = GREATEST(`current_value`, VALUES(`current_value`)), `updated_at` = NOW(3);
INSERT INTO `app_sequence` (`key`, `current_value`, `created_at`, `updated_at`)
SELECT 'VC_SIGNATURE_ALBUM', COUNT(*), NOW(3), NOW(3) FROM `visual_curation_module_project` WHERE `module` = 'album'
ON DUPLICATE KEY UPDATE `current_value` = GREATEST(`current_value`, VALUES(`current_value`)), `updated_at` = NOW(3);
