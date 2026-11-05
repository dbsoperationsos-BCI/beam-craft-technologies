-- `SETTINGS / Template Settings`, the permission Settings → Template Settings answers to - a section
-- of its own, empty for now.
--
-- Written here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on
-- production (IAM.md step 10). Same `module`, `feature` and `level` as the catalogue, which is what
-- the seed upserts on, so a seeded environment finds this row rather than making a second one.
--
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for any other role that
-- should see the section, and re-save them.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Template Settings', 'SETTINGS_TEMPLATE_SETTINGS', 'Template Settings',
       'Settings → Template Settings: a section of its own, empty for now',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Template Settings' AND `existing`.`level` = 'SETTINGS_TEMPLATE_SETTINGS'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Template Settings' AND `permission`.`level` = 'SETTINGS_TEMPLATE_SETTINGS'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
