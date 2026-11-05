-- Settings → Template Settings: the day of its payroll month a payslip is generated and reaches the
-- employee. Empty until the studio sets one - until then a payslip appears once its pay cycle ends.
ALTER TABLE `hrm_settings` ADD COLUMN `payslip_generate_day` INTEGER NULL;
