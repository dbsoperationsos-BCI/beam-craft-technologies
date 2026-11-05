-- Settings → User Settings → Automatic WhatsApp Message → Attendance WhatsApp Report: an on / off
-- switch for the daily report. Off, the scheduler sends nothing; the send time, the senders and the
-- group name are kept. True by default, so every studio goes on exactly as before this column.
--
-- Cost: one column on a one-row table. Instant.

ALTER TABLE `hrm_settings` ADD COLUMN `attendance_report_enabled` BOOLEAN NOT NULL DEFAULT true;
