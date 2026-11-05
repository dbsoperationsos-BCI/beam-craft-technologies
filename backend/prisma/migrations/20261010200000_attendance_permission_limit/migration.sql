-- Settings → Employee → Attendance Rules → Permissions: how many permissions a period allows.
--
-- `permissions_per_period`: the most permissions one employee may have pending, sent back or approved
-- in one period; a request past it is refused, saying the period and how many were used. 0 is no
-- limit, as before - every existing setting is left at 0, so nothing changes until it is set.
-- `permission_period`: what a period is - CALENDAR_MONTH (1st to the month's last day) or PAY_CYCLE
-- (Payroll rules' cycle: a permission counts in the payroll month whose cycle holds its date), as
-- Casual Leave counts its months. Permissions already raised are not re-checked.
--
-- Cost: two columns with defaults on the one-row `attendance_settings`. Instant.

ALTER TABLE `attendance_settings`
    ADD COLUMN `permissions_per_period` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `permission_period` VARCHAR(20) NOT NULL DEFAULT 'CALENDAR_MONTH';
