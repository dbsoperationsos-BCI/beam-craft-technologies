-- A payroll row's Base Salary is the employee's Total Salary as it stands (after every review), each month
-- afresh and editable on the row for that month alone. It is no longer split by the share of the pay cycle
-- each salary was in force, so the record of that split - added by `20261012180000_payroll_lifecycle` - goes.
-- Rows keep the base salary they already hold.

ALTER TABLE `payroll_entry` DROP COLUMN `base_salary_breakdown`;
