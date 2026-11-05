-- A policy breach can be loss-of-pay days instead of an amount.
--
-- `deduct_by` is AMOUNT for every breach already recorded (the default), and `total_days` is NULL
-- on them - so each keeps deducting exactly what it did. `policy_breach_lop_days` on a payroll row
-- starts at 0, which is what every row already holds: no LOP breach existed before this.
--
-- Three columns added, no existing value changed, so there is nothing to fail on production data.

ALTER TABLE `payroll_policy_breach` ADD COLUMN `deduct_by` VARCHAR(10) NOT NULL DEFAULT 'AMOUNT', ADD COLUMN `total_days` DECIMAL(6, 1) NULL;
ALTER TABLE `payroll_entry` ADD COLUMN `policy_breach_lop_days` DECIMAL(6, 2) NOT NULL DEFAULT 0;
