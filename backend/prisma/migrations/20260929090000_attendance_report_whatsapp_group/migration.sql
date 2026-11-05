-- The Attendance Register's daily report, sent automatically into a WhatsApp group at 9:45 am (studio
-- time) every day, from the WhatsApp of whoever linked the group.
--
-- On the studio-wide HR settings row, beside the referral and pay-period settings:
--
--   attendance_report_group_jid      the group (a Baileys group JID), null until one is linked
--   attendance_report_group_subject  its name when linked, for the page to show
--   attendance_report_sender_user_id whose WhatsApp session sends it - sessions are per user, so the
--                                    scheduled send has to be told whose; SET NULL if that user goes
--   attendance_report_linked_at      when the group was linked
--   attendance_report_last_sent_on   the studio day the report last went out - the once-a-day guard,
--                                    which survives a restart and two processes starting together
--   attendance_report_last_attempt_at  the last try, sent or not - the claim that stops two tries at once
--   attendance_report_last_error     why the last try failed, for the page; null after a send
--
-- Cost: seven nullable columns and one foreign key on a one-row table. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `attendance_report_group_jid` VARCHAR(64) NULL,
  ADD COLUMN `attendance_report_group_subject` VARCHAR(500) NULL,
  ADD COLUMN `attendance_report_sender_user_id` INTEGER NULL,
  ADD COLUMN `attendance_report_linked_at` DATETIME(3) NULL,
  ADD COLUMN `attendance_report_last_sent_on` DATE NULL,
  ADD COLUMN `attendance_report_last_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `attendance_report_last_error` VARCHAR(500) NULL;

CREATE INDEX `hrm_settings_attendance_report_sender_user_id_idx` ON `hrm_settings`(`attendance_report_sender_user_id`);

ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_attendance_report_sender_user_id_fkey`
  FOREIGN KEY (`attendance_report_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
