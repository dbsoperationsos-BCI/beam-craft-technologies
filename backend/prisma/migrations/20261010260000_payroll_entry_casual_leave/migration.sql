-- HRM → Payroll → Main Page: Casual Leave Taken on the register.
--
-- `casual_leave_days`: the leave days in the row's pay cycle that the Casual Leave balance (Settings →
-- Employee → Attendance Rules) covered - paid. Brought in from attendance with the rest of the row, and
-- stored on it like `attendance_leaves`, so a month no longer updated keeps what it was paid with.
--
-- Attendance Leaves is every day away in the cycle - absences, half days as half, and approved leave -
-- and Total Leaves, the loss of pay, is Attendance Leaves and Policy Breach Leaves less these days. With
-- no Casual Leave set, every approved leave day counts as covered, so leave stays paid as before.
--
-- Every existing row starts at 0 and takes its figure the next time its month updates.
--
-- Cost: one NOT NULL decimal with a default on `payroll_entry`. Instant.

ALTER TABLE `payroll_entry` ADD COLUMN `casual_leave_days` DECIMAL(6, 2) NOT NULL DEFAULT 0;
