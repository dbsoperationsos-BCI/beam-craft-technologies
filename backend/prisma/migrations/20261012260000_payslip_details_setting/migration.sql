-- Settings → Template Settings: whether a payslip carries the employee's personal details alone, or
-- the personal details and the PF details. Both, as every payslip has until now, by default.
ALTER TABLE `hrm_settings` ADD COLUMN `payslip_details` VARCHAR(20) NOT NULL DEFAULT 'PERSONAL_AND_PF';
