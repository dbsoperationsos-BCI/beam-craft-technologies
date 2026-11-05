-- The payback is a day of the month, not a date: salary is paid out on the same day every month - the
-- 10th unless the studio changes it - so there is nothing to set again each month.
--
-- Replaces `payback_date` (20260928140000, a single date) with `payback_day`, 1 to 31, defaulting to
-- 10. A day past the end of a short month means that month's last day. The old column held at most
-- one test value and is dropped rather than converted.
--
-- Cost: one column swapped on a one-row table. Instant.

ALTER TABLE `hrm_settings`
  DROP COLUMN `payback_date`,
  ADD COLUMN `payback_day` INTEGER NOT NULL DEFAULT 10;
