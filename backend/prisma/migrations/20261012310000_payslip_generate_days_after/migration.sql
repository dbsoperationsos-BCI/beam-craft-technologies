-- Settings → Template Settings: a payslip is now generated a number of days after its month's payable
-- (payback due) date, rather than on a day of the payroll month. The column says what it now holds, and
-- what it held is cleared - a day of the month is not a number of days after the payable date - so a
-- payslip appears once its pay cycle ends until the studio chooses again.
ALTER TABLE `hrm_settings` RENAME COLUMN `payslip_generate_day` TO `payslip_generate_days_after`;
UPDATE `hrm_settings` SET `payslip_generate_days_after` = NULL;
