-- HRM → Payroll → Main Page: leavers, removed rows, mid-cycle salary changes and late changes.
--
-- `payroll_entry`:
--   * `days_after_relieving` - the cycle's days after the relieving date, unpaid like the days before
--     joining, so a leaver is paid up to their last day.
--   * `base_salary_breakdown` - how the base salary was made up where it changed inside the cycle.
--   * `prior_adjustment` - the approved prior-month adjustments landing in this month; Net Salary adds it.
--   * `removed_at`, `removed_by_user_id`, `removed_reason` - a row removed on the Main Page is kept and
--     marked, so the month's update does not add the employee back; Restore clears them.
-- `payroll_adjustment` - a late change to a closed month, waiting for approval before it lands in the
-- next open month.
--
-- `late_changes_tracked`: whether a late change to the month is rechecked once it closes. Rows already
-- there start false - they were worked out without leavers, joiners' days or salary history, and would
-- all look changed - and every row made from now on true.
--
-- Existing rows take 0 / null; an open month's take their figures the next time it updates, a closed
-- month's stay as they were paid.
--
-- Cost: seven columns on `payroll_entry` (four with defaults, two nullable) and one new table. Instant.

ALTER TABLE `payroll_entry`
  ADD COLUMN `days_after_relieving` DECIMAL(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `base_salary_breakdown` JSON NULL,
  ADD COLUMN `prior_adjustment` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `removed_at` DATETIME(3) NULL,
  ADD COLUMN `removed_by_user_id` INTEGER NULL,
  ADD COLUMN `removed_reason` VARCHAR(500) NULL,
  ADD COLUMN `late_changes_tracked` BOOLEAN NOT NULL DEFAULT false;

-- Rows from here on are tracked; the ones above stay as they were.
ALTER TABLE `payroll_entry` ALTER COLUMN `late_changes_tracked` SET DEFAULT true;

CREATE INDEX `payroll_entry_removed_by_user_id_idx` ON `payroll_entry`(`removed_by_user_id`);
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_removed_by_user_id_fkey` FOREIGN KEY (`removed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `payroll_adjustment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `source_year` INTEGER NOT NULL,
  `source_month` INTEGER NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `target_year` INTEGER NULL,
  `target_month` INTEGER NULL,
  `decided_by_user_id` INTEGER NULL,
  `decided_at` DATETIME(3) NULL,
  `decision_remarks` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `payroll_adjustment_employee_id_source_year_source_month_idx`(`employee_id`, `source_year`, `source_month`),
  INDEX `payroll_adjustment_status_idx`(`status`),
  INDEX `payroll_adjustment_target_year_target_month_idx`(`target_year`, `target_month`),
  INDEX `payroll_adjustment_decided_by_user_id_idx`(`decided_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Money owed to or taken back from the employee: kept, like their payroll rows, so the employee cannot be deleted from under it.
ALTER TABLE `payroll_adjustment` ADD CONSTRAINT `payroll_adjustment_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payroll_adjustment` ADD CONSTRAINT `payroll_adjustment_decided_by_user_id_fkey` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
