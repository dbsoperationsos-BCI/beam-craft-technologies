-- Ticking rows on a table, anywhere in the application, becomes a permission of its own.
--
-- `SALES / CRM Lead Select All` and `HRM / Interview Select All` gave two screens a column of tick
-- boxes and a pair of bulk routes behind it. Every other table in the application is worked a row
-- at a time. This is the general case underneath those two: one row that turns the boxes on
-- wherever a table draws them, and guards the two acts a selection leads to - exporting the ticked
-- rows, and deleting them together.
--
-- One row rather than one per table. The alternative was twenty-odd `<Module> Select All` rows
-- asking the studio the same question twenty-odd times, and a role that should be able to tidy up
-- after itself needing every one of them ticked. The existing two stay where they are: each guards
-- routes that do more than delete - a stage moved across a set, a vertical reassigned - so folding
-- them into this row would widen what one tick grants.
--
-- Here as a migration rather than as a line in the seed alone, because **the seed cannot be run on
-- production**. A guard naming a `module / feature` the `permission` table does not hold refuses
-- everybody but a Super Admin, and says so to nobody - CLAUDE.md Rule 4 - so without this row the
-- guards added across the module routers would quietly close the tick boxes to the entire studio.
-- `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature + level`, so
-- a seeded environment finds this one rather than making a second.
--
-- **No grants are copied, and that is the point.** It is meant to start withheld: deleting forty
-- records in one press is not implied by being allowed to delete one, and inheriting it from every
-- screen's own Read / Write would leave nothing restricted. After this runs, only a Super Admin
-- selects until the roles that should have it are ticked in Role Management and re-saved.
--
-- Cost: one row, plus the Super Admin grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'ADMIN', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Table Select All' AS `feature`, 'TABLE_SELECT_ALL' AS `level`, 'Select Table Rows in Bulk' AS `display_name`,
         'Read / Write to tick rows on any table in the application and act on the whole selection at once - exporting the ticked rows, and deleting them together. Without it the tick boxes are absent and records are worked one at a time' AS `description`
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'ADMIN'
    AND `existing`.`feature` = 'Table Select All'
    AND `existing`.`level` = 'TABLE_SELECT_ALL'
);

-- SUPER_ADMIN is described as full access across every branch and holds every permission there is
-- (20260917100000). A new one it does not hold is a hole in the one role that is supposed to have
-- none, and it cannot be filled from Administration -> Roles, which refuses to edit a system role.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'TABLE_SELECT_ALL'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
