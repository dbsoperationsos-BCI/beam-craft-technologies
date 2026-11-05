-- HRM → Payroll → Main Page: Comp-Off Taken on the register.
--
-- `comp_off_taken_days`: the approved comp-off days off in the row's pay cycle. A count, shown on the
-- register and its export: a comp-off is never paid for and never taken off - the day worked was a
-- weekly off or holiday, paid already, and the day off is paid like any working day. Brought in from
-- attendance with the rest of the row, like `casual_leave_days`, so a month no longer updated keeps
-- what it was paid with.
--
-- Every existing row starts at 0 and takes its figure the next time its month updates.
--
-- Cost: one NOT NULL decimal with a default on `payroll_entry`. Instant.

ALTER TABLE `payroll_entry` ADD COLUMN `comp_off_taken_days` DECIMAL(6, 2) NOT NULL DEFAULT 0;
