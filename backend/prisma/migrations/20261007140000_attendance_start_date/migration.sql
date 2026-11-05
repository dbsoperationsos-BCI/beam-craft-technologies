-- Settings → Employee → Attendance Rules → Attendance starts on: the day the studio's attendance
-- starts being counted - set to the go-live day so the days before it are not read as absences.
--
-- One nullable date on the one-row `attendance_settings`. NULL counts every day, exactly as before,
-- so nothing changes until somebody sets it. No permission: the rules are already edited under
-- HRM / Attendance Rules.
--
-- Cost: one column on a one-row table. Instant.
ALTER TABLE `attendance_settings` ADD COLUMN `attendance_start_date` DATE NULL;
