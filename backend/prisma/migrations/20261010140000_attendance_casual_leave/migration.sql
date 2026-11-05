-- Settings → Employee → Attendance Rules → Casual Leave.
--
-- Every approved Leave is Casual Leave. Each employee is credited `casual_leave_per_month` days at the
-- start of every month, from their joining month (or the month attendance starts being counted, if
-- later); leave days take from that balance in date order, and a leave day beyond it is Loss of Pay,
-- which the attendance calculator - and so the payroll register - deducts.
--
-- `casual_leave_monthly_carry`: unused leave carries into the next month (true) or lapses at the end
-- of each month (false). On 1 January at most `casual_leave_year_carry_max` days are carried into the
-- new year (0: every unused day lapses). The leave year is the calendar year.
--
-- Off until set: 0 days a month is no Casual Leave at all, and every approved leave stays paid, as it
-- was. Nothing is stored per employee - the balance is worked out from the approved leave each time
-- it is read - so no row is written here.
--
-- Cost: three columns with defaults on the one-row `attendance_settings`. Instant. No permission:
-- edited under HRM / Attendance Rules like the rest of the row.

ALTER TABLE `attendance_settings`
    ADD COLUMN `casual_leave_per_month` DECIMAL(4, 1) NOT NULL DEFAULT 0,
    ADD COLUMN `casual_leave_monthly_carry` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `casual_leave_year_carry_max` DECIMAL(5, 1) NOT NULL DEFAULT 0;
