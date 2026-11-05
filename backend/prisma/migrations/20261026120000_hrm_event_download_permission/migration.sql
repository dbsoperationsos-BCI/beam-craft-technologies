-- Downloading an event's photos becomes a permission of its own: `HRM / Event Download`.
--
-- HRM -> Events gains a Download on each event, which saves its photos - the photo itself, or a ZIP
-- of several. Seeing the studio's wall and taking its photos away are different decisions, so the
-- second is granted in Role Management apart from `HRM / Events`.
--
-- Here as a migration rather than as a line in the seed alone, because **the seed cannot be run on
-- production**. A guard naming a `module / feature` the `permission` table does not hold refuses
-- everybody but a Super Admin, and says so to nobody - CLAUDE.md Rule 4. `seeds/permission-catalogue.js`
-- holds the same row and upserts on `module + feature + level`, so a seeded environment finds this
-- one rather than making a second.
--
-- **No grants are copied from `HRM / Events`.** It starts withheld: only a Super Admin downloads until
-- the roles that should have it are ticked in Role Management and re-saved.
--
-- Cost: one row, plus the Super Admin grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Event Download' AS `feature`, 'EVENT_DOWNLOAD' AS `level`, 'Download Events' AS `display_name`,
         'HRM → Events: Download on each event, saving its photos - the photo itself, or a ZIP of several. Needs HRM → Events as well. Without it there is no Download and the photos can only be viewed' AS `description`
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM'
    AND `existing`.`feature` = 'Event Download'
    AND `existing`.`level` = 'EVENT_DOWNLOAD'
);

-- SUPER_ADMIN is described as full access across every branch and holds every permission there is
-- (20260917100000). A new one it does not hold is a hole in the one role that is supposed to have
-- none, and it cannot be filled from Administration -> Roles, which refuses to edit a system role.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'EVENT_DOWNLOAD'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
