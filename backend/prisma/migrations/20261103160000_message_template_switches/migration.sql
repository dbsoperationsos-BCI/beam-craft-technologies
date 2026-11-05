-- Settings → Templates: an ON / OFF for each message the studio sends over WhatsApp. A message with no
-- row is ON, so every message keeps being sent exactly as before until somebody switches one off.
-- OFF hides and refuses that message's Send WhatsApp button and stops its automatic sends.
--
-- Cost: one empty table. No existing row changes. No new permission: a switch answers to the
-- permission that rewords its message (`SETTINGS / Message Template`, or `SETTINGS / Wishes`).

CREATE TABLE `message_template_switch` (
  `key` VARCHAR(60) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `message_template_switch_updated_by_user_id_idx`(`updated_by_user_id`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `message_template_switch` ADD CONSTRAINT `message_template_switch_updated_by_user_id_fkey`
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
