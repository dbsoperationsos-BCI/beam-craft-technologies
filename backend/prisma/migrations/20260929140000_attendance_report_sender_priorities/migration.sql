-- The Attendance Register's daily WhatsApp report is tried from up to three people's WhatsApp, in
-- order: Priority 1, then 2, then 3, the first that sends ending it. An administrator picks the three
-- from the people holding `HRM / Attendance WhatsApp Report`; each connects their own WhatsApp.
--
--   attendance_report_sender_user_id    (existing) is Priority 1 - whoever sends it today keeps sending it
--   attendance_report_sender2_user_id   Priority 2, tried when Priority 1 cannot send
--   attendance_report_sender3_user_id   Priority 3, tried when neither can
--   attendance_report_last_sent_by_user_id  who sent the last report, for the page to say
--
-- Each SET NULL if that user goes. Cost: three nullable columns and two foreign keys on a one-row table.

ALTER TABLE `hrm_settings`
  ADD COLUMN `attendance_report_sender2_user_id` INTEGER NULL,
  ADD COLUMN `attendance_report_sender3_user_id` INTEGER NULL,
  ADD COLUMN `attendance_report_last_sent_by_user_id` INTEGER NULL;

CREATE INDEX `hrm_settings_attendance_report_sender2_user_id_idx` ON `hrm_settings`(`attendance_report_sender2_user_id`);
CREATE INDEX `hrm_settings_attendance_report_sender3_user_id_idx` ON `hrm_settings`(`attendance_report_sender3_user_id`);

ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_attendance_report_sender2_user_id_fkey`
  FOREIGN KEY (`attendance_report_sender2_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_attendance_report_sender3_user_id_fkey`
  FOREIGN KEY (`attendance_report_sender3_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
