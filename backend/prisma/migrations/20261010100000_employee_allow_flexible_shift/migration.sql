-- Employee Preference → Attendance → Allow Flexible Shift.
--
-- An employee with this ticked is offered a fifth work mode at login, Flexible Shift: they log in
-- whenever they start, and the day is judged on the hours from that login to the logout alone - the
-- same Half day and Full day rule as everybody else, but never Late or Early exit, because there is
-- no shift start or end to be late for. On a day with no login yet they read "Yet to log in" until
-- the day is over, rather than Absent from the shift start.
--
-- Every existing employee is left off (false), so nothing changes until HR ticks it, and the server
-- refuses a Flexible Shift login from anybody it is not ticked for.
--
-- Cost: one NOT NULL boolean column with a default on `employee`. No row is rewritten by hand.

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `allow_flexible_shift` BOOLEAN NOT NULL DEFAULT false;
