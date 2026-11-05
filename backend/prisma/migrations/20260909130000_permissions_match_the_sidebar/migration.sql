-- Make the permission catalogue describe the sidebar, screen for screen.
--
-- Role Management draws its blocks from `permission.module` and its rows from `permission.feature`,
-- while the menu draws from `frontend/src/constants/navigation.mjs`. The two were never held to
-- each other, and had drifted in three ways, each of which this migration closes:
--
--   1. CRD Documents sits under Project Management in the menu and under Sales & CRM in Role
--      Management, because its permission still says `SALES`. Somebody granting "the projects
--      screens" did not grant it, and had no way to know why.
--   2. Contacts and Reports & Analytics are screens in the menu with no row of their own: both
--      answered for `SALES / CRM Leads`, so neither could be granted or withheld on its own.
--      They are the two "sub-modules missing from the RBAC".
--   3. `ACCOUNTS / Payroll Management` guards no route and opens no screen. It moved to
--      `HRM / Employee Referral` when the referral register became a screen of its own, and the
--      row was left behind - grantable, and granting nothing.
--
-- Nobody loses access. The CRD row is *updated* rather than replaced, so every grant naming it
-- follows it to its new module; and the two new rows are created here, with every existing
-- `CRM Leads` grant copied onto them, so a role that could open the CRM can still open the reports
-- and the directory it could open yesterday. Withholding one of them from a role is now possible,
-- which is the point, but it is a decision somebody takes rather than one this migration takes.
--
-- The seed (`backend/prisma/seeds/iam-roles-permissions.js`) upserts all four rows afterwards on
-- `module + feature + level` and will find them exactly as written here. It never writes grants,
-- which is why the copy below is a migration rather than a line in the seed.
--
-- Cost: four rows and a copy of one permission's grants. Instant.

-- 1. CRD Documents belongs to the module whose screen it is.
--    Keyed on the level, which is the one part of the row that never moved.
UPDATE `permission`
SET `module` = 'PROJECT',
    `description` = 'Issue and review the client requirement documents raised against a project'
WHERE `module` = 'SALES'
  AND `feature` = 'CRD Documents'
  AND `level` = 'CRD_MANAGE';

-- 2a. Contacts: its own row, so the directory can be granted without the CRM board.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Contacts', 'CONTACT_DIRECTORY_READ', 'Contacts',
       'The contact directory: every number the studio holds, each source shown only to somebody who may read that module',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` WHERE `module` = 'SALES' AND `feature` = 'Contacts' AND `level` = 'CONTACT_DIRECTORY_READ'
);

-- 2b. Reports & Analytics: likewise, so a manager can be given the reports without the board.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Reports & Analytics', 'CRM_REPORT_READ', 'Reports & Analytics',
       'The CRM reports and the sales dashboard over them, narrowed to the leads the reader may see',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` WHERE `module` = 'SALES' AND `feature` = 'Reports & Analytics' AND `level` = 'CRM_REPORT_READ'
);

-- 2c. Every role that could open the CRM keeps both screens, at the level it already held.
--     `NOT EXISTS` rather than `INSERT IGNORE` so a re-run is a no-op rather than a silent skip.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, `grant`.`access_level`, NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `leads`
  ON `leads`.`id` = `grant`.`permissionId`
 AND `leads`.`module` = 'SALES'
 AND `leads`.`feature` = 'CRM Leads'
JOIN `permission` AS `new`
  ON `new`.`module` = 'SALES'
 AND `new`.`feature` IN ('Contacts', 'Reports & Analytics')
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permission` AS `already`
  WHERE `already`.`roleId` = `grant`.`roleId` AND `already`.`permissionId` = `new`.`id`
);

-- 3. Payroll Management guards nothing and opens nothing. `role_permission` cascades from
--    `permission`, so this takes any leftover grants with it.
DELETE FROM `permission`
WHERE `module` = 'ACCOUNTS'
  AND `feature` = 'Payroll Management';
