-- A half day now runs from "Half day from" up to the full day (`daily_target_minutes`), so the
-- separate "Half day up to" setting is gone.
ALTER TABLE `attendance_settings` DROP COLUMN `half_day_max_minutes`;
