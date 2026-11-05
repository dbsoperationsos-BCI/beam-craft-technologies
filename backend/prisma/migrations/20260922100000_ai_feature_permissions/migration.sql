-- The AI Feature's three permissions, written where production can hold them.
--
-- Visual Curation gains a third screen, AI Feature: event galleries with face recognition, kept
-- entirely apart from Image Selection and Album Proofing in code, tables and storage. It is filed
-- under `IMAGE_SELECTION` because that is the module key of the Visual Curation menu section, and a
-- screen's permission belongs to the section the menu files it under (IAM.md, "The catalogue
-- describes the sidebar"). Role Management already titles that module "Visual Curation".
--
-- Three rows rather than one, because three different people do three different jobs on it:
--
--   IMAGE_SELECTION / AI Feature                 opens the screen; Read / Write runs events, media,
--                                                guests and sharing
--   IMAGE_SELECTION / AI Face Management         the People and match reviews inside an event -
--                                                renaming, merging, hiding, linking to a guest,
--                                                confirming and rejecting matches, retrying failures
--   IMAGE_SELECTION / AI Event Default Settings  the studio-wide template behind More → Event
--                                                Default Settings
--
-- The seed cannot be run on production (CLAUDE.md), so a permission added only to
-- `seeds/permission-catalogue.js` never reaches the VPS - and a guard naming a permission the
-- `permission` table does not hold refuses everybody but a Super Admin, silently. Same `module`,
-- `feature` and `level` as the catalogue, which is what the seed upserts on.
--
-- No grants are copied from `Project Management`: nothing held this before, and running a face
-- recognition gallery is not implied by running a selection gallery. Until the roles that should
-- reach it are ticked in Role Management and re-saved, only a Super Admin opens AI Feature - and
-- SUPER_ADMIN is granted all three below, as every new permission must be
-- (test/iam-super-admin-grants.test.js).
--
-- Cost: three rows and three grants. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'AI Feature' AS `feature`, 'ISAI_FEATURE' AS `level`, 'AI Feature' AS `display_name`,
         'AI event galleries: create and run events, their sub-events, media, guests and the guest link' AS `description`
  UNION ALL
  SELECT 'AI Face Management', 'ISAI_FACE_MANAGE', 'AI Face Management',
         'The People and face-match reviews inside an AI event: name, merge, split and hide people, link them to guests, confirm or reject matches, retry failed processing'
  UNION ALL
  SELECT 'AI Event Default Settings', 'ISAI_SETTINGS', 'AI Event Default Settings',
         'The studio-wide defaults every new AI event is created from, behind AI Feature → More → Event Default Settings'
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` IN ('ISAI_FEATURE', 'ISAI_FACE_MANAGE', 'ISAI_SETTINGS')
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
