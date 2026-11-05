-- HRM -> Payroll -> Recovery: money an employee owes the studio, taken back from their salary over a
-- run of months. A new table, and its own permission `HRM / Payroll Recovery`.
--
-- The table holds only what is entered - the employee (an id with its key, never a copy of the
-- name), the total, the start month and year, the number of months and the reason. The monthly
-- deduction, the start and end dates and the status are worked out on read.
--
-- The permission is here as a migration rather than as a line in the seed alone, because the seed
-- cannot be run on production - a guard naming a permission the table does not hold refuses
-- everybody but a Super Admin. `seeds/permission-catalogue.js` holds the same row and upserts on
-- `module + feature + level`, so a seeded environment finds this one rather than making a second.
-- Granted Read / Write to the SUPER_ADMIN role only; every other role starts at DISABLED, and the
-- studio grants it in Role Management.
--
-- Cost: one new, empty table, one permission row and one grant. Instant; touches no existing row.

CREATE TABLE `payroll_recovery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recovery_id` VARCHAR(20) NOT NULL,
    `employee_id` INTEGER NOT NULL,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `start_month` INTEGER NOT NULL,
    `start_year` INTEGER NOT NULL,
    `months` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by_id` INTEGER NULL,
    `delete_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_recovery_recovery_id_key`(`recovery_id`),
    INDEX `payroll_recovery_employee_id_idx`(`employee_id`),
    INDEX `payroll_recovery_created_by_id_idx`(`created_by_id`),
    INDEX `payroll_recovery_updated_by_id_idx`(`updated_by_id`),
    INDEX `payroll_recovery_deleted_by_id_idx`(`deleted_by_id`),
    INDEX `payroll_recovery_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payroll_recovery` ADD CONSTRAINT `payroll_recovery_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payroll_recovery` ADD CONSTRAINT `payroll_recovery_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_recovery` ADD CONSTRAINT `payroll_recovery_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_recovery` ADD CONSTRAINT `payroll_recovery_deleted_by_id_fkey` FOREIGN KEY (`deleted_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payroll Recovery', 'PAYROLL_RECOVERY', 'Payroll Recovery', 'Payroll -> Recovery: amounts taken back from salary over months', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payroll Recovery' AND `existing`.`level` = 'PAYROLL_RECOVERY'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payroll Recovery' AND `permission`.`level` = 'PAYROLL_RECOVERY'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
