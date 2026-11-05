-- HRM → Payroll → Main Page: the register updates itself, so a figure typed by hand has to be marked.
--
-- The Main Page no longer has Generate and Refresh: opening a month brings it up to date - every
-- working employee given a row, every row not paid or frozen read again from attendance, advances and
-- recovery - for the month still being paid and every one after it; an earlier month is only filled in
-- once, where it has no rows. An automatic update must not undo a correction somebody typed, so a row
-- now remembers whether its Base Salary (`base_salary_typed`) or Attendance Leaves
-- (`attendance_leaves_typed`) was typed by hand, and the update leaves that figure as typed.
--
-- Every existing row is left unmarked (false): it follows attendance and the salary on record, as
-- Refresh did for it before. No row is rewritten.
--
-- Cost: two NOT NULL booleans with defaults on `payroll_entry`. Instant.

ALTER TABLE `payroll_entry`
    ADD COLUMN `base_salary_typed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `attendance_leaves_typed` BOOLEAN NOT NULL DEFAULT false;
