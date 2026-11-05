-- HRM -> Payroll -> Main Page -> Skip: a month's Salary Advance or Recovery Deduction left out.
--
-- `payroll_advance_skip`: an advance skipped in a payroll month is taken back from the next month not
-- skipped instead. `payroll_recovery_skip`: a recovery's instalment skipped in a month is not taken
-- that month, and the run takes one month longer - the same instalment, a later end date. Each row
-- names its advance or recovery by id with its key (CASCADE: they are never hard-deleted, and a skip
-- means nothing without them) and the month; deleting the row undoes the skip. One skip per advance
-- or recovery per month (the unique key, which also serves the foreign key).
--
-- Cost: two new, empty tables. Touches no existing row. No permission change: skipping is guarded by
-- `HRM / Payroll Register` with `HRM / Payroll Advance` or `HRM / Payroll Recovery`, all of which exist.

CREATE TABLE `payroll_advance_skip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `advance_id` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_advance_skip_created_by_user_id_idx`(`created_by_user_id`),
    UNIQUE INDEX `payroll_advance_skip_advance_id_year_month_key`(`advance_id`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payroll_recovery_skip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recovery_id` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_recovery_skip_created_by_user_id_idx`(`created_by_user_id`),
    UNIQUE INDEX `payroll_recovery_skip_recovery_id_year_month_key`(`recovery_id`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payroll_advance_skip` ADD CONSTRAINT `payroll_advance_skip_advance_id_fkey` FOREIGN KEY (`advance_id`) REFERENCES `payroll_advance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payroll_advance_skip` ADD CONSTRAINT `payroll_advance_skip_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payroll_recovery_skip` ADD CONSTRAINT `payroll_recovery_skip_recovery_id_fkey` FOREIGN KEY (`recovery_id`) REFERENCES `payroll_recovery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payroll_recovery_skip` ADD CONSTRAINT `payroll_recovery_skip_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
