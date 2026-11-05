-- Selecting a whole stage of the Interview register becomes a permission of its own.
--
-- It was carried by `HRM / Interview` Read / Write - the permission that also covers adding a
-- candidate, correcting a phone number and moving one stage. It is its own row now, for the same
-- reason `SALES / CRM Lead Select All` is: working a register one candidate at a time and acting on
-- the whole of it at once are different jobs, and the second is a write over a set the reader never
-- has to look at.
--
-- Here as a migration rather than as a line in the seed alone, because **the seed cannot be run on
-- production**. A guard naming a `module / feature` the `permission` table does not hold refuses
-- everybody but a Super Admin, and says so to nobody - CLAUDE.md Rule 4 - so without this row the
-- guards in `hrm/interview/routes.js` would quietly close the tick boxes to the entire studio.
-- `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature + level`, so a
-- seeded environment finds this one rather than making a second.
--
-- **No grants are copied, and that is the point.** It is meant to start withheld: the studio decides
-- who may move or delete a whole stage at once, and inheriting it from `HRM / Interview` would leave
-- nothing restricted, which is the opposite of what it is for. After this runs, only a Super Admin
-- selects until the roles that should have it are ticked in Role Management and re-saved.
--
-- Cost: one row, plus the Super Admin grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Interview Select All' AS `feature`, 'INTERVIEW_SELECT_ALL' AS `level`, 'Select Candidates in Bulk' AS `display_name`,
         'Read / Write to tick candidates on the Interview register and act on the whole selection at once - moving every ticked candidate to a stage, and deleting them together. Without it the tick boxes are absent and candidates are worked one at a time' AS `description`
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM'
    AND `existing`.`feature` = 'Interview Select All'
    AND `existing`.`level` = 'INTERVIEW_SELECT_ALL'
);

-- SUPER_ADMIN is described as full access across every branch and holds every permission there is
-- (20260917100000). A new one it does not hold is a hole in the one role that is supposed to have
-- none, and it cannot be filled from Administration -> Roles, which refuses to edit a system role.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'INTERVIEW_SELECT_ALL'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
