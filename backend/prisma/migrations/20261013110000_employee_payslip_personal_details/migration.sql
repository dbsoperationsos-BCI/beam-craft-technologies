-- Edit Employee -> Payslip Details -> Personal Details is typed by HR rather than read off the record:
-- `{ empCode, empName, department, designation, location, dateOfBirth, dateOfJoining, pan, bankAccount }`,
-- printed on the payslip as typed. Empty for everybody until HR fills it in.

ALTER TABLE `employee` ADD COLUMN `payslip_personal_details` JSON NULL;
