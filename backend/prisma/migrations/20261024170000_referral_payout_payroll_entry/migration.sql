-- Which payroll row paid a referral instalment. An instalment is handed over as the referrer's
-- Referral Bonus on Payroll → Main Page, so the row and the instalment have to be able to find each
-- other: setting a paid month back to Pending un-settles the instalments that month carried, and a
-- paid row reads its Referral IDs through this link rather than by recomputing what is still due.
--
-- Null on every row that exists: an instalment paid before this was handed over outside payroll.
-- `ON DELETE SET NULL`, so removing a payroll row never takes the record of a paid instalment with it.
ALTER TABLE `employee_referral_payout`
  ADD COLUMN `payroll_entry_id` INTEGER NULL;

CREATE INDEX `employee_referral_payout_payroll_entry_id_idx` ON `employee_referral_payout`(`payroll_entry_id`);

ALTER TABLE `employee_referral_payout`
  ADD CONSTRAINT `employee_referral_payout_payroll_entry_id_fkey` FOREIGN KEY (`payroll_entry_id`) REFERENCES `payroll_entry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
