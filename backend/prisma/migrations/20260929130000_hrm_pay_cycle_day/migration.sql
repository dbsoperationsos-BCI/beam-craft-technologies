-- Settings → Employee → Attendance calculator is two days of the month now, not a pair of dates:
--
--   pay_cycle_day  the day the pay cycle turns over - 25 is "the 25th to the 25th, every month" -
--                  so it is set once rather than again each month.
--   payback_day    unchanged: the day of the following month salary is paid out (10 by default).
--
-- `pay_period_start` and `pay_period_end` (20260928140000) held the one cycle's two dates and go:
-- the cycle day says the same thing for every month. They held at most a test value.
--
-- Cost: one column added and two dropped on a one-row table. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `pay_cycle_day` INTEGER NOT NULL DEFAULT 25,
  DROP COLUMN `pay_period_start`,
  DROP COLUMN `pay_period_end`;
