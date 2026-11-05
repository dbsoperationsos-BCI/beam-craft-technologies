-- Settings → Employee → Attendance Rules → Casual Leave → Count Casual Leave by.
--
-- What a "month" of Casual Leave is: CALENDAR_MONTH (the 1st to the month's last day - as it has
-- been) or PAY_CYCLE (the pay cycle Payroll rules set - October's payroll is 25 Aug to 24 Sep with the
-- cycle on the 25th). On the pay cycle, each cycle credits the days set, a leave day belongs to the
-- payroll month whose cycle holds it - the same payroll month that pays or deducts it - and the leave
-- year follows the payroll year, turning with January's payroll.
--
-- Every existing setting is left on the calendar month, so nothing changes until it is chosen.
--
-- Cost: one column with a default on the one-row `attendance_settings`. Instant.

ALTER TABLE `attendance_settings`
    ADD COLUMN `casual_leave_period` VARCHAR(20) NOT NULL DEFAULT 'CALENDAR_MONTH';
