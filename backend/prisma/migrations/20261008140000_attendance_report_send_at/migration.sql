-- Settings → Attendance WhatsApp Report → Sends daily at: the time the daily attendance report is
-- sent, on the studio's clock ("HH:MM", 24-hour), set by an administrator.
--
-- NULL is the default it has always had, 09:45 - so every studio keeps sending at 09:45 until
-- somebody changes it, and nothing has to be written for that.
--
-- Cost: one nullable column on the one-row `hrm_settings`. Instant.

-- AlterTable
ALTER TABLE `hrm_settings` ADD COLUMN `attendance_report_send_at` VARCHAR(5) NULL;
