-- Settings becomes a module of its own, one permission per entry on its rail.
--
-- `ADMIN / System Settings` was the whole overlay behind a single tick: the studio's branding and
-- branches, the message templates, the quotation brands, the login slide, the holidays and the
-- usage monitoring. Those are different jobs done by different people, and a studio wanting
-- somebody to keep the message wording had to hand them the lot - including the branding logo,
-- which the top bar, the sign-in page, every quotation and the client gallery all read.
--
-- So the catalogue now matches the rail, one row per title, under a `SETTINGS` module that Role
-- Management lists on its own rather than among Administration's user and role screens. Settings is
-- not Administration: it is reached from the top bar by everybody.
--
-- Nobody loses access. Every existing `ADMIN / System Settings` grant is copied onto all thirteen
-- new rows at the level it was held, so a role that could open Settings yesterday opens exactly as
-- much of it today. Withholding one section from a role is now *possible*, which is the point, but
-- it is a decision somebody takes rather than one this migration takes for them.
--
-- The old row is deactivated rather than deleted, which is what the seed does with a retired
-- permission: the grants naming it survive in case the split turns out to have been wrong, and
-- `getUserPermissions` and the Roles dialog both read `is_active`, so it stops granting and stops
-- being offered. Every guard that named it has been re-pointed in the same change.
--
-- Cost: thirteen rows and a copy of one permission's grants. Instant.

-- 1. The thirteen rail entries. Written exactly as `seeds/permission-catalogue.js` holds them, so
--    the seed's upsert on `module + feature + level` finds these rather than making a second set.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'User Settings' AS `feature`, 'SETTINGS_USER' AS `level`, 'User Settings' AS `display_name`,
         'Settings → User Settings: which logins are held to linking WhatsApp' AS `description`
  UNION ALL SELECT 'Table Settings', 'SETTINGS_TABLE', 'Table Settings',
         'Settings → Overall → Table: the fields a module''s table and forms carry. Also needs SALES / CRM Leads Read / Write, which is what the builder saves through'
  UNION ALL SELECT 'Field Settings', 'SETTINGS_FIELD', 'Field Settings',
         'Settings → Overall → Fields: the studio''s own lists behind the dropdowns. Also needs HRM / Employee Management Read / Write, which is what the lists save through'
  UNION ALL SELECT 'Project Settings', 'SETTINGS_PROJECT', 'Project Settings',
         'Settings → Overall → Project: services, deliverables and the production workflow. Also needs PROJECT / Projects Read / Write'
  UNION ALL SELECT 'Exclude Phone Numbers', 'SETTINGS_EXCLUDED_NUMBERS', 'Exclude Phone Numbers',
         'Settings → Exclude Phone Numbers: the numbers that must never become a lead. Also needs SALES / CRM Leads Read / Write'
  UNION ALL SELECT 'Integrations', 'SETTINGS_INTEGRATIONS', 'Integrations',
         'Settings → Integrations: the linked Google Sheets, Drive and Meet accounts. Also needs SALES / CRM Leads Read / Write, which is what linking a sheet answers for'
  UNION ALL SELECT 'Quotation Settings', 'SETTINGS_QUOTATION', 'Quotation Settings',
         'Settings → Quotation Settings: the quotation brands, their covers and the figures on them'
  UNION ALL SELECT 'Employee Referral', 'SETTINGS_REFERRAL', 'Employee Referral',
         'Settings → Employee Referral: what a referral pays. Also needs HRM / Employee Referral, which owns the register it is paid from'
  UNION ALL SELECT 'Message Template', 'SETTINGS_MESSAGE_TEMPLATE', 'Message Template',
         'Settings → Message Template: the wording the studio sends out'
  UNION ALL SELECT 'Organization', 'SETTINGS_ORGANIZATION', 'Organization',
         'Settings → Organization: the studio''s name, its branding logo and its branches. The logo is read by the top bar, the sign-in page, every quotation and the client gallery'
  UNION ALL SELECT 'Holidays', 'SETTINGS_HOLIDAYS', 'Holidays',
         'Settings → Holidays: the days the studio is closed, which every employee''s calendar and attendance read'
  UNION ALL SELECT 'Login Slide', 'SETTINGS_LOGIN_SLIDE', 'Login Slide',
         'Settings → Login Slide: the pictures the sign-in page shows'
  UNION ALL SELECT 'Application Monitoring', 'SETTINGS_MONITORING', 'Application Monitoring',
         'Settings → Application Monitoring: whether usage is recorded, and the email health check'
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);

-- 2. Every role that could open Settings keeps all thirteen sections, at the level it already held.
--    `NOT EXISTS` rather than `INSERT IGNORE`, so a re-run is a no-op rather than a silent skip.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, `grant`.`access_level`, NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId`
 AND `old`.`module` = 'ADMIN'
 AND `old`.`feature` = 'System Settings'
JOIN `permission` AS `new`
  ON `new`.`module` = 'SETTINGS'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permission` AS `already`
  WHERE `already`.`roleId` = `grant`.`roleId`
    AND `already`.`permissionId` = `new`.`id`
);

-- 3. The row that used to answer for all of it stops granting and stops being offered. Left in
--    place, with its grants, so the split can be read back and undone if it was wrong.
UPDATE `permission`
SET `is_active` = 0
WHERE `module` = 'ADMIN'
  AND `feature` = 'System Settings'
  AND `level` = 'SETTINGS_MANAGE';
