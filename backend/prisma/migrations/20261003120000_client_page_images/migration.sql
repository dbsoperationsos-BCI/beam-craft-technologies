-- Settings → Project Management → Client page images: the pictures the client sign-in page's film
-- strip carries (`/client/login`), kept apart from the staff sign-in's Login Slide pictures.
--
-- A JSON list of public image URLs in display order, on the studio-wide settings row beside
-- `login_slides`. Null means none: the strip shows its plain frames.
ALTER TABLE `image_selection_settings` ADD COLUMN `client_login_slides` JSON NULL;

-- `SETTINGS / Client Page Images`, the permission the new section and its endpoint answer to.
--
-- Written here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on
-- production (IAM.md step 10). Same `module`, `feature` and `level` as the catalogue, which is what
-- the seed upserts on, so a seeded environment finds this row rather than making a second one.
--
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for any other role that
-- should keep the client page's pictures, and re-save them.
--
-- Cost: one column on a one-row table, one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Client Page Images', 'SETTINGS_CLIENT_PAGE_IMAGES', 'Client Page Images',
       'Settings → Project Management → Client page images: the pictures the client sign-in page shows',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Client Page Images' AND `existing`.`level` = 'SETTINGS_CLIENT_PAGE_IMAGES'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Client Page Images' AND `permission`.`level` = 'SETTINGS_CLIENT_PAGE_IMAGES'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
