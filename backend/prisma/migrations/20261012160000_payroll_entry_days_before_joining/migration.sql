-- HRM → Payroll → Main Page: Before Joining on the register.
--
-- `days_before_joining`: the pay cycle's days before the employee's joining date - working days where a
-- day's pay is the salary over the cycle's working days, calendar days where it is over its calendar
-- days or a fixed 30. They are unpaid: Total Leaves adds them, so the loss-of-pay deduction takes them
-- off and somebody who joined part-way through a cycle is paid for the part they were employed.
--
-- Every existing row starts at 0 and takes its figure the next time its month updates; a paid or
-- frozen row keeps what it was settled with.
--
-- Cost: one NOT NULL decimal with a default on `payroll_entry`. Instant.

ALTER TABLE `payroll_entry` ADD COLUMN `days_before_joining` DECIMAL(6, 2) NOT NULL DEFAULT 0;
