-- `SETTINGS / Activity Log Purge`: the permission Settings → Activity Log Purge and
-- `/api/settings/activity-log-purge` answer to. Here as well as in `seeds/permission-catalogue.js`
-- because the seed cannot be run on production; the seed upserts on `module + feature + level`, so a
-- seeded database finds this row rather than making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Activity Log Purge', 'SETTINGS_ACTIVITY_LOG_PURGE', 'Activity Log Purge', 'Settings → Activity Log Purge: delete User Activity Logs lines older than 1, 2, 3 or 6 months', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Activity Log Purge' AND `existing`.`level` = 'SETTINGS_ACTIVITY_LOG_PURGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Activity Log Purge' AND `permission`.`level` = 'SETTINGS_ACTIVITY_LOG_PURGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
