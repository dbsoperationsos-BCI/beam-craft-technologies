-- HRM -> Payroll -> Main Page: the payroll register, one employee's pay for one month per row, and
-- its own permission `HRM / Payroll Register`. Also the two Payroll rules on `hrm_settings`: what a
-- day's pay is for the loss-of-pay deduction, and how the net salary is rounded for payment.
--
-- The permission is here as a migration rather than as a line in the seed alone, because the seed
-- cannot be run on production. `seeds/permission-catalogue.js` holds the same row and upserts on
-- `module + feature + level`, so a seeded environment finds this one rather than making a second.
-- Granted Read / Write to the SUPER_ADMIN role only; every other role starts at DISABLED.
--
-- `paid_lop_divisor` / `paid_rounding` keep the rules a row was paid under, so a month already paid
-- never moves when the rules change.
--
-- Cost: two columns with defaults on the one-row `hrm_settings`, one new empty table, one permission
-- row and one grant. Instant; changes no existing value.

ALTER TABLE `hrm_settings` ADD COLUMN `payroll_lop_divisor` VARCHAR(20) NOT NULL DEFAULT 'WORKING_DAYS',
    ADD COLUMN `payroll_rounding` VARCHAR(20) NOT NULL DEFAULT 'NEAREST_10';
CREATE TABLE `payroll_entry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `period_from` DATE NOT NULL,
    `period_to` DATE NOT NULL,
    `base_salary` DECIMAL(12, 2) NOT NULL,
    `incentive` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `attendance_leaves` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `policy_breach_leaves` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `working_days` INTEGER NOT NULL,
    `period_days` INTEGER NOT NULL,
    `salary_advance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `recovery_deduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `other_deductions` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `payment_status` VARCHAR(20) NOT NULL DEFAULT 'Pending',
    `payment_mode_id` INTEGER NULL,
    `payment_from` VARCHAR(120) NULL,
    `payment_date` DATE NULL,
    `payment_remarks` TEXT NULL,
    `paid_lop_divisor` VARCHAR(20) NULL,
    `paid_rounding` VARCHAR(20) NULL,
    `created_by_user_id` INTEGER NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `payroll_entry_year_month_idx`(`year`, `month`),
    INDEX `payroll_entry_payment_mode_id_idx`(`payment_mode_id`),
    INDEX `payroll_entry_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `payroll_entry_updated_by_user_id_idx`(`updated_by_user_id`),
    UNIQUE INDEX `payroll_entry_employee_id_year_month_key`(`employee_id`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_payment_mode_id_fkey` FOREIGN KEY (`payment_mode_id`) REFERENCES `payment_mode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payroll Register', 'PAYROLL_REGISTER', 'Payroll Register', 'Payroll -> Main Page: the monthly payroll register, and the Payroll rules', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payroll Register' AND `existing`.`level` = 'PAYROLL_REGISTER'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payroll Register' AND `permission`.`level` = 'PAYROLL_REGISTER'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
