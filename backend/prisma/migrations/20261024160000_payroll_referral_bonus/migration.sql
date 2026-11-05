-- Referral Bonus on the payroll row: what HRM → Employee Referral has due that month to the employee
-- who made the referral. An earning, brought in on generate and refresh like Policy Breach
-- Deduction is, never typed on the Main Page.
--
-- Zero on every row that already exists, which is what those months paid: a referral instalment was
-- handed over outside payroll until now, and a month already settled is not re-read.
ALTER TABLE `payroll_entry`
  ADD COLUMN `referral_bonus` DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER `incentive`;
