-- HRM -> Payroll -> Advance Salary: money paid to an employee ahead of their salary, taken back in
-- full from one month's payroll as that month's Salary Advance. A new table, and its own permission
-- `HRM / Payroll Advance`.
--
-- The table holds only what is entered - the date it was given, the employee (an id with its key,
-- never a copy of the name), the amount, the deduction month and year and the reason. The status is
-- worked out on read.
--
-- The permission is here as a migration rather than as a line in the seed alone, because the seed
-- cannot be run on production - a guard naming a permission the table does not hold refuses
-- everybody but a Super Admin. `seeds/permission-catalogue.js` holds the same row and upserts on
-- `module + feature + level`, so a seeded environment finds this one rather than making a second.
-- Granted Read / Write to the SUPER_ADMIN role only; every other role starts at DISABLED, and the
-- studio grants it in Role Management.
--
-- Cost: one new, empty table, one permission row and one grant. Instant; touches no existing row.

CREATE TABLE `payroll_advance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `advance_id` VARCHAR(20) NOT NULL,
    `employee_id` INTEGER NOT NULL,
    `advance_date` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `deduct_month` INTEGER NOT NULL,
    `deduct_year` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by_id` INTEGER NULL,
    `delete_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_advance_advance_id_key`(`advance_id`),
    INDEX `payroll_advance_employee_id_deduct_year_deduct_month_idx`(`employee_id`, `deduct_year`, `deduct_month`),
    INDEX `payroll_advance_created_by_id_idx`(`created_by_id`),
    INDEX `payroll_advance_updated_by_id_idx`(`updated_by_id`),
    INDEX `payroll_advance_deleted_by_id_idx`(`deleted_by_id`),
    INDEX `payroll_advance_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payroll_advance` ADD CONSTRAINT `payroll_advance_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payroll_advance` ADD CONSTRAINT `payroll_advance_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_advance` ADD CONSTRAINT `payroll_advance_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_advance` ADD CONSTRAINT `payroll_advance_deleted_by_id_fkey` FOREIGN KEY (`deleted_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payroll Advance', 'PAYROLL_ADVANCE', 'Payroll Advance', 'Payroll -> Advance Salary: amounts paid ahead of salary, taken back from one month''s payroll', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payroll Advance' AND `existing`.`level` = 'PAYROLL_ADVANCE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payroll Advance' AND `permission`.`level` = 'PAYROLL_ADVANCE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
