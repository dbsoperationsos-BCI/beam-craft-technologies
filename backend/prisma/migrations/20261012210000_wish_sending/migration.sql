-- Settings → Wishes are sent into the Attendance WhatsApp Report's group on each birthday and wedding
-- anniversary. The claim and the last error sit beside the report's own on the HR settings row.
ALTER TABLE `hrm_settings`
  ADD COLUMN `wishes_last_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `wishes_last_error` TEXT NULL;

-- One row a person, a kind and a day: nobody is wished twice, and the wish picked for them is kept.
CREATE TABLE `employee_wish` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `kind` VARCHAR(30) NOT NULL,
  `wished_on` DATE NOT NULL,
  `template_key` VARCHAR(60) NULL,
  `sent_by_user_id` INTEGER NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `employee_wish_employee_id_kind_wished_on_key`(`employee_id`, `kind`, `wished_on`),
  INDEX `employee_wish_template_key_idx`(`template_key`),
  INDEX `employee_wish_sent_by_user_id_idx`(`sent_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_wish` ADD CONSTRAINT `employee_wish_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_wish` ADD CONSTRAINT `employee_wish_template_key_fkey` FOREIGN KEY (`template_key`) REFERENCES `message_template`(`key`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `employee_wish` ADD CONSTRAINT `employee_wish_sent_by_user_id_fkey` FOREIGN KEY (`sent_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
