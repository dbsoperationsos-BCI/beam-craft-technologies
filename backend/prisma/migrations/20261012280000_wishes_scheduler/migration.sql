-- Settings → Wishes → Wishes Scheduler: the wishes' own WhatsApp group, send time and Priority 1 sender,
-- rather than the attendance report's. Empty until set - until a group is named, no wish is sent.
ALTER TABLE `hrm_settings`
  ADD COLUMN `wishes_group_name` VARCHAR(500) NULL,
  ADD COLUMN `wishes_send_at` VARCHAR(5) NULL,
  ADD COLUMN `wishes_sender_user_id` INTEGER NULL;

CREATE INDEX `hrm_settings_wishes_sender_user_id_idx` ON `hrm_settings`(`wishes_sender_user_id`);

-- A sender who is deleted leaves the scheduler without a Priority 1, rather than blocking the delete.
ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_wishes_sender_user_id_fkey` FOREIGN KEY (`wishes_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
