-- Settings → Payroll rules → Edit Payslip: an on/off for every item on the payslip. Everything starts
-- on, so no payslip changes until the studio turns something off.
ALTER TABLE `hrm_settings` ADD COLUMN `payslip_built_in_items` JSON NULL;
ALTER TABLE `payslip_field` ADD COLUMN `shown_on_payslip` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `payroll_component` ADD COLUMN `shown_on_payslip` BOOLEAN NOT NULL DEFAULT true;
