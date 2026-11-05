-- Settings → Employee → Attendance Rules → Comp-Off: how long a comp-off can be used.
--
-- `comp_off_expiry_days`: a comp-off earned by working a weekly off or a declared holiday has to be
-- taken within this many days of the day worked - with 30, a Sunday worked on 4 Oct is used by 3 Nov.
-- 0 is no expiry, as before; every existing setting is left at 0, so nothing changes until it is set.
-- Comp-offs already raised are not re-checked.
--
-- Cost: one column with a default on the one-row `attendance_settings`. Instant.

ALTER TABLE `attendance_settings`
    ADD COLUMN `comp_off_expiry_days` INTEGER NOT NULL DEFAULT 0;
