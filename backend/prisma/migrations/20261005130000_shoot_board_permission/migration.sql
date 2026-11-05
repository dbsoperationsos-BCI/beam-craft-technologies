-- `PROJECT / Shoot Board`: the week of shoots the viewer and their team are named on, by day,
-- coloured by project (Project Management → Shoot Board).
--
-- Here as a migration rather than as a line in the seed alone, because the seed cannot be run on
-- production - a guard naming a permission the table does not hold refuses everybody but a Super
-- Admin. `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature +
-- level`, so a seeded environment finds this one rather than making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management to whoever should see the board.
--
-- Cost: one permission row, one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'PROJECT', 'Shoot Board', 'SHOOTBOARD_VIEW', 'Shoot Board',
       'A week of the shoots you and your team are named on, by day, coloured by project',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'PROJECT' AND `existing`.`feature` = 'Shoot Board' AND `existing`.`level` = 'SHOOTBOARD_VIEW'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'PROJECT' AND `permission`.`feature` = 'Shoot Board' AND `permission`.`level` = 'SHOOTBOARD_VIEW'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
