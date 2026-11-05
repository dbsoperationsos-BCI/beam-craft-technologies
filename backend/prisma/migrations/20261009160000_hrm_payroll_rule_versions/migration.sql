-- Settings -> Payroll rules, kept by the payroll month they apply from, so changing the rules moves the
-- current month and later ones only: earlier months - generated or not - keep the rules they had, and
-- a paid month keeps the rules it was paid under as before.
--
-- One new table. It starts empty: until the rules are first changed every month reads them from
-- `hrm_settings` as it does today, and the first change records the rules as they stood before it
-- (from January 2000) beside the new ones - so nothing has to be filled in here.
--
-- No permission: it answers to `HRM / Payroll Register`, like the rules themselves.
--
-- Cost: one new, empty table. Instant; touches no existing row.

CREATE TABLE `payroll_rule_version` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `effective_year` INTEGER NOT NULL,
    `effective_month` INTEGER NOT NULL,
    `lop_divisor` VARCHAR(20) NOT NULL,
    `rounding` VARCHAR(20) NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_rule_version_created_by_user_id_idx`(`created_by_user_id`),
    UNIQUE INDEX `payroll_rule_version_effective_year_effective_month_key`(`effective_year`, `effective_month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payroll_rule_version` ADD CONSTRAINT `payroll_rule_version_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
