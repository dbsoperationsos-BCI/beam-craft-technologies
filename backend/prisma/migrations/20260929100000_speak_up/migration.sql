-- CreateTable
CREATE TABLE `speak_up` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NULL,
    `employee_name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `attachment_key` VARCHAR(500) NULL,
    `attachment_file_name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `speak_up_employee_id_idx`(`employee_id`),
    INDEX `speak_up_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `speak_up` ADD CONSTRAINT `speak_up_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Speak-up: a confidential line to HR. Two permissions, `HRM / Speak-up` (submit + own history)
-- and `HRM / Speak-up Review` (HR reads everyone's) - here as a migration rather than only in the
-- seed, because the seed cannot run on production and a guard naming a permission the table does
-- not hold refuses everybody but a Super Admin. `seeds/permission-catalogue.js` holds the same two
-- rows and upserts on `module + feature + level`, so a seeded environment finds these rather than
-- making a second pair.
--
-- Who gets it, to start with (Role Management can change any of it afterwards):
--   * Read / Write for SUPER_ADMIN.
--   * Read / Write for `Speak-up`, for every role holding `HRM / Employee Attendance` at any level -
--     everyone who can already raise their own leave request is meant to be able to speak up too.
--   * Read / Write for `Speak-up Review`, for every role holding `HRM / Employee Management` at
--     Read / Write - HR, who post and edit employee records.
-- The Admin Permission set every Branch Admin carries gets `Speak-up` by the first rule, so a
-- branch admin can submit their own. It does not get `Speak-up Review`: this is confidential to HR,
-- and a Branch Admin is a broader role than HR over a table that is not branch-scoped.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Speak-up', 'SPEAK_UP', 'Speak-up',
       'Write HR something personal, and see your own past Speak-ups',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Speak-up' AND `existing`.`level` = 'SPEAK_UP'
);

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Speak-up Review', 'SPEAK_UP_REVIEW', 'Speak-up Review',
       'Read every Speak-up submitted, across every branch',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Speak-up Review' AND `existing`.`level` = 'SPEAK_UP_REVIEW'
);

-- SUPER_ADMIN holds every permission there is (20260917100000).
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
  FROM `role` JOIN `permission` ON `permission`.`module` = 'HRM' AND `permission`.`feature` IN ('Speak-up', 'Speak-up Review')
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;

-- Read / Write on Speak-up for every role holding Employee Attendance at any level.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Employee Attendance'
 AND `old`.`level` = 'ATTENDANCE_MARK'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Speak-up' AND `new`.`level` = 'SPEAK_UP'
WHERE `grant`.`access_level` IN ('READ', 'READ_WRITE')
  AND NOT EXISTS (SELECT 1 FROM `role_permission` AS `already` WHERE `already`.`roleId` = `grant`.`roleId` AND `already`.`permissionId` = `new`.`id`);

-- Read / Write on Speak-up Review for every role that writes Employee Management.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Employee Management'
 AND `old`.`level` = 'EMPLOYEE_MANAGE'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Speak-up Review' AND `new`.`level` = 'SPEAK_UP_REVIEW'
WHERE `grant`.`access_level` = 'READ_WRITE'
  AND NOT EXISTS (SELECT 1 FROM `role_permission` AS `already` WHERE `already`.`roleId` = `grant`.`roleId` AND `already`.`permissionId` = `new`.`id`);

-- The Branch Admin set: Read / Write on Speak-up only (see the note above).
INSERT INTO `branch_admin_permission` (`id`, `permission_id`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `new`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `branch_admin_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permission_id` AND `old`.`module` = 'HRM' AND `old`.`feature` = 'Employee Attendance'
JOIN `permission` AS `new`
  ON `new`.`module` = 'HRM' AND `new`.`feature` = 'Speak-up' AND `new`.`level` = 'SPEAK_UP'
WHERE `grant`.`access_level` IN ('READ', 'READ_WRITE')
  AND NOT EXISTS (SELECT 1 FROM `branch_admin_permission` AS `already` WHERE `already`.`permission_id` = `new`.`id`)
LIMIT 1;
