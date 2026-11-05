-- Employee Preference → Exclude → Exclude From Attendance.
--
-- An employee with this ticked is kept out of the Attendance module altogether: not listed on the
-- register or dashboard, not counted in its totals or the daily WhatsApp report, and none of their
-- days or details shown there.
--
-- Every existing employee is left in (false), so nothing changes until somebody ticks it.
--
-- Cost: one NOT NULL boolean column with a default on `employee`. No row is rewritten by hand.

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `exclude_from_attendance` BOOLEAN NOT NULL DEFAULT false;
