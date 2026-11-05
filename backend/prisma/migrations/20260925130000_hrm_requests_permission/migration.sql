-- `HRM / Requests`: the permission behind HRM → Request, the screen for leave, permission and
-- comp-off requests.
--
-- A screen of its own needs a permission of its own - Role Management offers one row per screen - so
-- this is not `HRM / Employee Attendance`, which Employee Attendance answers to. The request
-- endpoints accept either, so neither screen can be opened onto refusals.
--
-- Here as a migration rather than as a line in the seed alone, because **the seed cannot be run on
-- production**: a guard naming a permission the table does not hold refuses everybody but a Super
-- Admin. `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature +
-- level`, so a seeded environment finds this one rather than making a second.
--
-- **Grants are carried across from Employee Attendance**, at the same level: everybody who can read
-- and raise requests on Employee Attendance today can open the screen that shows the same requests,
-- and nobody gains anything they did not already have - roles, and the Admin Permission set every
-- Branch Admin carries. Roles can be narrowed in Role Management afterwards. SUPER_ADMIN holds every
-- permission, so it is granted this one too.
--
-- Cost: one permission row, one grant per role holding Employee Attendance, at most one Admin
-- Permission row. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Requests', 'ATTENDANCE_REQUESTS', 'Requests',
       'HRM → Request: raise and track your own leave, permission and comp-off requests, and answer the ones you are named an approver on',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM'
    AND `existing`.`feature` = 'Requests'
    AND `existing`.`level` = 'ATTENDANCE_REQUESTS'
);

-- Every role holding Employee Attendance holds Requests at the same level.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, `grant`.`access_level`, NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId`
 AND `old`.`module` = 'HRM'
 AND `old`.`feature` = 'Employee Attendance'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Requests' AND `new`.`level` = 'ATTENDANCE_REQUESTS'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permission` AS `already`
  WHERE `already`.`roleId` = `grant`.`roleId`
    AND `already`.`permissionId` = `new`.`id`
);

-- The Admin Permission set every Branch Admin carries (20260919150000) the same way: where it names
-- Employee Attendance, it names Requests at the same level.
INSERT INTO `branch_admin_permission` (`id`, `permission_id`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `new`.`id`, `grant`.`access_level`, NOW(3), NOW(3)
FROM `branch_admin_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permission_id`
 AND `old`.`module` = 'HRM'
 AND `old`.`feature` = 'Employee Attendance'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Requests' AND `new`.`level` = 'ATTENDANCE_REQUESTS'
WHERE NOT EXISTS (
  SELECT 1 FROM `branch_admin_permission` AS `already`
  WHERE `already`.`permission_id` = `new`.`id`
);

-- SUPER_ADMIN holds every permission there is (20260917100000).
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Requests' AND `permission`.`level` = 'ATTENDANCE_REQUESTS'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
