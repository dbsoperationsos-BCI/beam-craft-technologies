-- HRM -> Payroll -> Policy Breach: an amount an employee is fined for breaking a studio policy, taken
-- from their salary over a run of months, exactly as a recovery is. Two new tables, one new column on
-- `payroll_entry`, and its own permission `HRM / Payroll Policy Breach`.
--
-- `payroll_policy_breach` holds only what is entered - the employee (an id with its key, never a copy
-- of the name), the total, the start month and year, the number of months and the reason. The monthly
-- deduction, the start and end dates and the status are worked out on read.
-- `payroll_policy_breach_skip` is a month skipped on the Main Page, as `payroll_recovery_skip` is.
-- `payroll_entry.policy_breach_deduction` is what the month takes, brought in on generate and refresh;
-- it is separate from `policy_breach_leaves`, the loss-of-pay days typed on the row, which is unchanged.
--
-- The permission is here as a migration rather than as a line in the seed alone, because the seed
-- cannot be run on production. `seeds/permission-catalogue.js` holds the same row and upserts on
-- `module + feature + level`. Granted Read / Write to the SUPER_ADMIN role only; every other role starts
-- at DISABLED, and the studio grants it in Role Management.
--
-- Cost: two new, empty tables; one column added to `payroll_entry` with a constant default (every
-- existing row reads 0, so no figure already worked out changes); one permission row and one grant.

-- AlterTable
ALTER TABLE `payroll_entry` ADD COLUMN `policy_breach_deduction` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `payroll_policy_breach` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `policy_breach_id` VARCHAR(20) NOT NULL,
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

    UNIQUE INDEX `payroll_policy_breach_policy_breach_id_key`(`policy_breach_id`),
    INDEX `payroll_policy_breach_employee_id_idx`(`employee_id`),
    INDEX `payroll_policy_breach_created_by_id_idx`(`created_by_id`),
    INDEX `payroll_policy_breach_updated_by_id_idx`(`updated_by_id`),
    INDEX `payroll_policy_breach_deleted_by_id_idx`(`deleted_by_id`),
    INDEX `payroll_policy_breach_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_policy_breach_skip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `policy_breach_id` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_policy_breach_skip_created_by_user_id_idx`(`created_by_user_id`),
    UNIQUE INDEX `payroll_policy_breach_skip_policy_breach_id_year_month_key`(`policy_breach_id`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach` ADD CONSTRAINT `payroll_policy_breach_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach` ADD CONSTRAINT `payroll_policy_breach_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach` ADD CONSTRAINT `payroll_policy_breach_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach` ADD CONSTRAINT `payroll_policy_breach_deleted_by_id_fkey` FOREIGN KEY (`deleted_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach_skip` ADD CONSTRAINT `payroll_policy_breach_skip_policy_breach_id_fkey` FOREIGN KEY (`policy_breach_id`) REFERENCES `payroll_policy_breach`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_policy_breach_skip` ADD CONSTRAINT `payroll_policy_breach_skip_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payroll Policy Breach', 'PAYROLL_POLICY_BREACH', 'Payroll Policy Breach', 'Payroll -> Policy Breach: fines for a policy breach taken from salary over months', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payroll Policy Breach' AND `existing`.`level` = 'PAYROLL_POLICY_BREACH'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payroll Policy Breach' AND `permission`.`level` = 'PAYROLL_POLICY_BREACH'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
