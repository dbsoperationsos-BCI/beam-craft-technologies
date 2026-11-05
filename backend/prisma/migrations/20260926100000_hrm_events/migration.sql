-- HRM → Events: a studio event somebody posted, a photograph and a description, for everybody to see.
--
-- The table, and `HRM / Events`, the permission behind the screen: Read to look at the events, Read /
-- Write to post and remove them. Here as a migration rather than as a line in the seed alone, because
-- the seed cannot be run on production - a guard naming a permission the table does not hold refuses
-- everybody but a Super Admin. `seeds/permission-catalogue.js` holds the same row and upserts on
-- `module + feature + level`, so a seeded environment finds this one rather than making a second.
--
-- Who gets it, to start with (Role Management can change any of it afterwards):
--   * Read / Write for SUPER_ADMIN, and for every role that can write HRM / Employee Management -
--     HR, who are the people posting an event.
--   * Read for every other role holding HRM / Task Management, which is meant to be granted to every
--     role - so the studio as a whole can see what was posted.
-- The Admin Permission set every Branch Admin carries follows the same two rules.

CREATE TABLE `hrm_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(150) NOT NULL,
  `description` TEXT NOT NULL,
  `event_date` DATE NULL,
  `image_url` MEDIUMTEXT NOT NULL,
  `image_key` VARCHAR(255) NULL,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `hrm_event_event_date_idx`(`event_date`),
  INDEX `hrm_event_created_by_id_idx`(`created_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hrm_event` ADD CONSTRAINT `hrm_event_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Events', 'EVENTS', 'Events',
       'HRM → Events: see the studio''s events; Read / Write also posts an event''s photo and description, and removes one',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Events' AND `existing`.`level` = 'EVENTS'
);

-- SUPER_ADMIN holds every permission there is (20260917100000).
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
  FROM `role` JOIN `permission` ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Events' AND `permission`.`level` = 'EVENTS'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;

-- Read / Write for every role that can write Employee Management.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Employee Management'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Events' AND `new`.`level` = 'EVENTS'
WHERE `grant`.`access_level` = 'READ_WRITE'
  AND NOT EXISTS (SELECT 1 FROM `role_permission` AS `already` WHERE `already`.`roleId` = `grant`.`roleId` AND `already`.`permissionId` = `new`.`id`);

-- Read for every other role holding Task Management.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, 'READ', NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Task Management'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Events' AND `new`.`level` = 'EVENTS'
WHERE `grant`.`access_level` IN ('READ', 'READ_WRITE')
  AND NOT EXISTS (SELECT 1 FROM `role_permission` AS `already` WHERE `already`.`roleId` = `grant`.`roleId` AND `already`.`permissionId` = `new`.`id`);

-- The Branch Admin set: Read / Write where it writes Employee Management, otherwise Read where it
-- holds Task Management.
INSERT INTO `branch_admin_permission` (`id`, `permission_id`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `new`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `branch_admin_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permission_id` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Employee Management'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Events' AND `new`.`level` = 'EVENTS'
WHERE `grant`.`access_level` = 'READ_WRITE'
  AND NOT EXISTS (SELECT 1 FROM `branch_admin_permission` AS `already` WHERE `already`.`permission_id` = `new`.`id`)
LIMIT 1;

INSERT INTO `branch_admin_permission` (`id`, `permission_id`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `new`.`id`, 'READ', NOW(3), NOW(3)
FROM `branch_admin_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permission_id` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Task Management'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Events' AND `new`.`level` = 'EVENTS'
WHERE `grant`.`access_level` IN ('READ', 'READ_WRITE')
  AND NOT EXISTS (SELECT 1 FROM `branch_admin_permission` AS `already` WHERE `already`.`permission_id` = `new`.`id`)
LIMIT 1;
