-- Four attendance permissions for what used to be decided by "is this login an administrator" alone,
-- so Role Management can grant each one to whoever needs it:
--
--   HRM / Attendance Rules       Read / Write changes the shift, weekly offs, half-day band, office
--                                locations and check-in quotes (everybody can still read the rules).
--   HRM / Attendance Logs        Read shows the Self Dashboard's Login Summary and Break Summary, and
--                                opens the Break Summary's endpoint.
--   HRM / All Requests           Read shows every request in the studio on HRM → Request, not only
--                                one's own and the ones one is named an approver on. Seeing is not
--                                deciding: who decides is still the approvers on the request.
--   HRM / Attendance Calculator  Read opens Settings → Employee → Attendance calculator, which reads
--                                anybody's attendance and salary.
--
-- Here as a migration rather than as lines in the seed alone, because the seed cannot be run on
-- production - a guard naming a permission the table does not hold refuses everybody but a Super
-- Admin. `seeds/permission-catalogue.js` holds the same rows and upserts on `module + feature +
-- level`, so a seeded environment finds these rather than making second ones.
--
-- **Nobody gains or loses anything.** Each is granted Read / Write to exactly the roles whose members
-- were administrators before - the SUPER_ADMIN role and every active role carrying the Administrator
-- tick (`role.is_admin`) - which is who the code let through until now. Anybody else is granted one
-- in Role Management. Not added to the Branch Admin permission set: a Branch Admin was not an
-- administrator for any of these.
--
-- Cost: four permission rows, one grant each per administrator role. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), `row`.`module`, `row`.`feature`, `row`.`level`, `row`.`display_name`, `row`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'HRM' AS `module`, 'Attendance Rules' AS `feature`, 'ATTENDANCE_RULES' AS `level`, 'Attendance Rules' AS `display_name`,
         'Read / Write changes the attendance rules: shift, weekly offs, half-day band, office locations and check-in quotes' AS `description`
  UNION ALL
  SELECT 'HRM', 'Attendance Logs', 'ATTENDANCE_LOGS', 'Attendance Logs',
         'See the Login Summary and Break Summary on the Self Dashboard'
  UNION ALL
  SELECT 'HRM', 'All Requests', 'ATTENDANCE_ALL_REQUESTS', 'All Requests',
         'See every leave, permission and other attendance request in the studio on HRM → Request (deciding stays with the named approvers)'
  UNION ALL
  SELECT 'HRM', 'Attendance Calculator', 'ATTENDANCE_CALCULATOR', 'Attendance Calculator',
         'Settings → Employee → Attendance calculator: anybody''s payable days and salary for a pay period'
) AS `row`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = `row`.`module` AND `existing`.`feature` = `row`.`feature` AND `existing`.`level` = `row`.`level`
);

-- Read / Write to the SUPER_ADMIN role and every active administrator role, for all four.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM'
 AND (`permission`.`feature`, `permission`.`level`) IN (
   ('Attendance Rules', 'ATTENDANCE_RULES'),
   ('Attendance Logs', 'ATTENDANCE_LOGS'),
   ('All Requests', 'ATTENDANCE_ALL_REQUESTS'),
   ('Attendance Calculator', 'ATTENDANCE_CALCULATOR')
 )
WHERE (`role`.`name` = 'SUPER_ADMIN' OR (`role`.`is_admin` = 1 AND `role`.`is_active` = 1))
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
