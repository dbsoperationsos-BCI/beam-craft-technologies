-- Visual Curation → AI Culling: the sidebar entry and dashboard of its own.
--
-- One permission row, IMAGE_SELECTION / AI Culling. It opens the AI Culling dashboard and the
-- read-only summary behind it (`GET /api/image-selection/stage-dashboards/ai-culling`) and nothing
-- else: the AI Culling tab inside a project, and every culling endpoint it calls, stay on
-- IMAGE_SELECTION / Project Management as they always were. The row is written here as well as in
-- `seeds/permission-catalogue.js`, with the same module, feature and level, because the seed cannot
-- be run on production (CLAUDE.md Rule 4, IAM.md step 10).
--
-- Only SUPER_ADMIN is granted it. Every other role starts at DISABLED until the studio ticks it in
-- Role Management and re-saves.
--
-- Cost: one permission row and one grant. No table or column changes. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', 'AI Culling', 'ISAI_CULLING', 'AI Culling',
       'The AI Culling dashboard under Visual Curation: every project''s culling runs, where they stand and what they kept. Running and reviewing a cull inside a project stays with Manage Image Selection', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION'
    AND `existing`.`feature` = 'AI Culling'
    AND `existing`.`level` = 'ISAI_CULLING'
);

-- Super Admin holds every permission there is (test/iam-super-admin-grants.test.js).
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'ISAI_CULLING'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
