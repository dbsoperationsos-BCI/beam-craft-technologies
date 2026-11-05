-- Settings -> Payroll rules -> Extra columns: columns the studio adds to Payroll -> Main Page under
-- Earnings or Deductions, and each payroll row's amount for them. Two new tables.
--
-- `payroll_component` is the column - its name, whether it is an earning or a deduction, its order,
-- and whether it is archived. `payroll_entry_component` is one row's amount for one column, keyed by
-- both ids (unique together); a row's amounts go with it when the row is removed (CASCADE), and a
-- column that still holds amounts cannot be deleted (RESTRICT) - it is archived instead.
--
-- No permission: both answer to `HRM / Payroll Register`, which the register and its rules already use.
--
-- Cost: two new, empty tables. Instant; touches no existing row.

CREATE TABLE `payroll_component` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `archived_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_component_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `payroll_component_updated_by_user_id_idx`(`updated_by_user_id`),
    UNIQUE INDEX `payroll_component_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payroll_entry_component` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entry_id` INTEGER NOT NULL,
    `component_id` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_entry_component_component_id_idx`(`component_id`),
    UNIQUE INDEX `payroll_entry_component_entry_id_component_id_key`(`entry_id`, `component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payroll_component` ADD CONSTRAINT `payroll_component_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_component` ADD CONSTRAINT `payroll_component_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_entry_component` ADD CONSTRAINT `payroll_entry_component_entry_id_fkey` FOREIGN KEY (`entry_id`) REFERENCES `payroll_entry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payroll_entry_component` ADD CONSTRAINT `payroll_entry_component_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `payroll_component`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
