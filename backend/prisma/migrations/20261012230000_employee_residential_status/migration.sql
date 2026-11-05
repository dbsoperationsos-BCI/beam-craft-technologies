-- Edit Employee → Payslip Details → Personal Details: the one detail the payslip prints that nothing
-- else on the record holds. Resident or Non-Resident; empty until HR answers it.
ALTER TABLE `employee` ADD COLUMN `residential_status` VARCHAR(30) NULL;
