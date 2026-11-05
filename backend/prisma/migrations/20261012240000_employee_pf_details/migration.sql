-- Edit Employee → Payslip Details → PF Details: the PF and ESI numbers the payslip prints, typed by
-- HR. Empty for every employee until they are filled in.
ALTER TABLE `employee`
  ADD COLUMN `pf_number` VARCHAR(30) NULL,
  ADD COLUMN `uan_number` VARCHAR(12) NULL,
  ADD COLUMN `eps_number` VARCHAR(30) NULL,
  ADD COLUMN `esi_number` VARCHAR(17) NULL;
