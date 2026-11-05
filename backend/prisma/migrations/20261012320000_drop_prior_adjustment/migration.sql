-- Prior Month Adjustment is retired: a late change to a closed payroll month is no longer worked out,
-- queued for approval or carried into the next month. Drops what `20261012180000_payroll_lifecycle`
-- added for it - the `payroll_adjustment` queue and `payroll_entry`'s `prior_adjustment` and
-- `late_changes_tracked`. Any pending or approved adjustment is discarded; Net Salary is Total Earned
-- less Total Deductions again.

ALTER TABLE `payroll_adjustment` DROP FOREIGN KEY `payroll_adjustment_employee_id_fkey`;
ALTER TABLE `payroll_adjustment` DROP FOREIGN KEY `payroll_adjustment_decided_by_user_id_fkey`;
DROP TABLE `payroll_adjustment`;

ALTER TABLE `payroll_entry`
  DROP COLUMN `prior_adjustment`,
  DROP COLUMN `late_changes_tracked`;
