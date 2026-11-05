-- AI Editing: the second tab of an Image Selection project, between AI Culling and Photo Selection.
-- Everything here is additive and nullable, so every existing photo, project and album reads exactly
-- as it did: a photo nobody edits has no edit row and no hold, and a project created before the tab
-- existed shows the tabs it always had.
--
--   image_selection_upload.editing_hold_at   the photo is in the AI Editing bay before Photo
--                                            Selection has seen it (added through the tab, or sent
--                                            there from AI Culling while still held); off every Photo
--                                            Selection surface until AI Editing sends it on
--   image_selection_upload.edit_of_upload_id the source this row is the compressed, edited copy of
--   image_selection_project.ai_editing_tab   the tick on the Create New Project form
--   image_selection_edit                     one record per source photo: the recipe and the latest
--                                            rendered output. The source and its derivatives are
--                                            never written to.
--
-- One permission row, IMAGE_SELECTION / AI Editing: Read opens the tab and sees the edits, Read /
-- Write uploads into it, edits, renders and sends photos on. The row is written here as well as in
-- `seeds/permission-catalogue.js`, with the same module, feature and level, because the seed cannot
-- be run on production (CLAUDE.md Rule 4, IAM.md step 10). Nothing else is granted: until a role is
-- ticked in Role Management and re-saved, only a Super Admin opens the tab - and SUPER_ADMIN is
-- granted it below, as every new permission must be (test/iam-super-admin-grants.test.js). Sending
-- into Photo Selection still answers to Project Management and into the album to Signature Album;
-- the destinations keep their own guards.
--
-- Cost: three nullable columns, one small table, one permission row and one grant. Instant.

ALTER TABLE `image_selection_upload` ADD COLUMN `editing_hold_at` DATETIME(3) NULL;
ALTER TABLE `image_selection_upload` ADD COLUMN `edit_of_upload_id` VARCHAR(191) NULL;
CREATE INDEX `image_selection_upload_edit_of_upload_id_idx` ON `image_selection_upload`(`edit_of_upload_id`);
ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_edit_of_upload_id_fkey`
  FOREIGN KEY (`edit_of_upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `image_selection_project` ADD COLUMN `ai_editing_tab` BOOLEAN NULL;

CREATE TABLE `image_selection_edit` (
  `id` VARCHAR(191) NOT NULL,
  `project_id` VARCHAR(191) NOT NULL,
  `upload_id` VARCHAR(191) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER NOT NULL DEFAULT 0,
  `recipe` JSON NULL,
  `applied_recipe` JSON NULL,
  `source_kind` VARCHAR(20) NULL,
  `output_key` VARCHAR(1024) NULL,
  `output_preview_key` VARCHAR(1024) NULL,
  `output_thumbnail_key` VARCHAR(1024) NULL,
  `output_width` INTEGER NULL,
  `output_height` INTEGER NULL,
  `output_bytes` INTEGER NULL,
  `reference_key` VARCHAR(1024) NULL,
  `error` TEXT NULL,
  `stage` VARCHAR(60) NULL,
  `engine_version` VARCHAR(60) NULL,
  `rendered_at` DATETIME(3) NULL,
  `sent_to_photos_upload_id` VARCHAR(191) NULL,
  `sent_to_photos_version` INTEGER NULL,
  `sent_to_album_photo_id` VARCHAR(191) NULL,
  `sent_to_album_version` INTEGER NULL,
  `created_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `image_selection_edit_upload_id_key`(`upload_id`),
  INDEX `image_selection_edit_project_id_status_idx`(`project_id`, `status`),
  INDEX `image_selection_edit_created_by_user_id_idx`(`created_by_user_id`),
  INDEX `image_selection_edit_sent_to_photos_upload_id_idx`(`sent_to_photos_upload_id`),
  INDEX `image_selection_edit_sent_to_album_photo_id_idx`(`sent_to_album_photo_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `image_selection_edit` ADD CONSTRAINT `image_selection_edit_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `image_selection_edit` ADD CONSTRAINT `image_selection_edit_upload_id_fkey`
  FOREIGN KEY (`upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `image_selection_edit` ADD CONSTRAINT `image_selection_edit_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- Where the current version went - links, so a deleted copy or album photo clears itself.
ALTER TABLE `image_selection_edit` ADD CONSTRAINT `image_selection_edit_sent_to_photos_upload_id_fkey`
  FOREIGN KEY (`sent_to_photos_upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `image_selection_edit` ADD CONSTRAINT `image_selection_edit_sent_to_album_photo_id_fkey`
  FOREIGN KEY (`sent_to_album_photo_id`) REFERENCES `signature_album_photo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The permission, where production can hold it.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', 'AI Editing', 'ISAI_EDITING', 'AI Editing',
       'The AI Editing tab of an Image Selection project: upload photos into it, edit them with the AI tools, and send the edited versions on to Photo Selection or the Signature Album', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION'
    AND `existing`.`feature` = 'AI Editing'
    AND `existing`.`level` = 'ISAI_EDITING'
);

-- Super Admin holds every permission there is; a new one it does not hold is a hole in exactly the
-- role that is supposed to have none, and cannot be filled from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'ISAI_EDITING'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
