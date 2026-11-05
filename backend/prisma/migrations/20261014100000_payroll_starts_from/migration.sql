-- Settings -> Payroll rules -> Payroll starts from: the first payroll month the Main Page keeps (the
-- 1st of it). A month before it is never made, read or paid out as a payslip. Null: the first month
-- whose pay cycle starts on or after the attendance start date, worked out when read.

ALTER TABLE `hrm_settings` ADD COLUMN `payroll_starts_from` DATE NULL;
