-- Approving a Salary Advance payment request now writes the payroll row that takes the money back
-- off a payslip, instead of leaving somebody to retype it in HRM -> Payroll -> Advance Salary. This
-- is the link back to the request that asked for it.
--
-- NULL on every advance entered by hand, which is every row that exists today, so adding the column
-- cannot fail on production data.
ALTER TABLE `payroll_advance` ADD COLUMN `payment_request_id` INTEGER NULL;

-- UNIQUE, not a plain index: one request may leave only one deduction behind it, so approving the
-- same request twice can never double-charge the employee. Safe to add - every existing row is NULL,
-- and MySQL allows many NULLs in a unique index.
CREATE UNIQUE INDEX `payroll_advance_payment_request_id_key` ON `payroll_advance`(`payment_request_id`);

ALTER TABLE `payroll_advance`
  ADD CONSTRAINT `payroll_advance_payment_request_id_fkey`
  FOREIGN KEY (`payment_request_id`) REFERENCES `payment_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
