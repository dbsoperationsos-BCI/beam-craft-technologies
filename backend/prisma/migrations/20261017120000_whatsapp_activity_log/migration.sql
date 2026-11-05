-- Settings → WhatsApp Activity Log: one row per WhatsApp message the app tried to send, manual or
-- automatic, over the paired-phone sessions or the Meta Cloud API, and one row per attempt at it.
-- Written only by `src/services/whatsappActivity.js`, which every send path now goes through.
--
-- `recipient_address` is the raw phone number or group id, kept so a failed message can be sent
-- again to the same place from the log; the API answers with `recipient_masked` only. `body` is
-- kept only for messages that may be resent - credentials are stored as a redacted preview.
--
-- Cost: two empty tables. Instant.

CREATE TABLE `whatsapp_activity` (
  `id` VARCHAR(191) NOT NULL,
  `logical_key` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(12) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `source_module` VARCHAR(40) NOT NULL,
  `trigger` VARCHAR(80) NOT NULL,
  `event_ref` VARCHAR(191) NULL,
  `initiated_by_user_id` INTEGER NULL,
  `sender_user_id` INTEGER NULL,
  `sales_project_id` VARCHAR(191) NULL,
  `crm_lead_id` VARCHAR(100) NULL,
  `employee_id` INTEGER NULL,
  `image_selection_project_id` VARCHAR(191) NULL,
  `production_id` VARCHAR(191) NULL,
  `image_selection_notification_id` VARCHAR(191) NULL,
  `recipient_kind` VARCHAR(10) NOT NULL,
  `recipient_masked` VARCHAR(191) NOT NULL,
  `recipient_name` VARCHAR(191) NULL,
  `recipient_address` VARCHAR(191) NULL,
  `template_key` VARCHAR(60) NULL,
  `body_preview` VARCHAR(500) NULL,
  `body` TEXT NULL,
  `resendable` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `failure_code` VARCHAR(60) NULL,
  `failure_reason` VARCHAR(255) NULL,
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `provider_message_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `attempted_at` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `delivered_at` DATETIME(3) NULL,
  `read_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `whatsapp_activity_logical_key_key`(`logical_key`),
  INDEX `whatsapp_activity_created_at_idx`(`created_at`),
  INDEX `whatsapp_activity_status_created_at_idx`(`status`, `created_at`),
  INDEX `whatsapp_activity_mode_created_at_idx`(`mode`, `created_at`),
  INDEX `whatsapp_activity_source_module_created_at_idx`(`source_module`, `created_at`),
  INDEX `whatsapp_activity_trigger_created_at_idx`(`trigger`, `created_at`),
  INDEX `whatsapp_activity_provider_message_id_idx`(`provider_message_id`),
  INDEX `whatsapp_activity_initiated_by_user_id_idx`(`initiated_by_user_id`),
  INDEX `whatsapp_activity_sender_user_id_idx`(`sender_user_id`),
  INDEX `whatsapp_activity_sales_project_id_idx`(`sales_project_id`),
  INDEX `whatsapp_activity_crm_lead_id_idx`(`crm_lead_id`),
  INDEX `whatsapp_activity_employee_id_idx`(`employee_id`),
  INDEX `whatsapp_activity_image_selection_project_id_idx`(`image_selection_project_id`),
  INDEX `whatsapp_activity_template_key_idx`(`template_key`),
  INDEX `whatsapp_activity_production_id_idx`(`production_id`),
  INDEX `whatsapp_activity_image_selection_notification_id_idx`(`image_selection_notification_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_activity_attempt` (
  `id` VARCHAR(191) NOT NULL,
  `activity_id` VARCHAR(191) NOT NULL,
  `attempt_no` INTEGER NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `requested_by_user_id` INTEGER NULL,
  `sender_user_id` INTEGER NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'PROCESSING',
  `provider_message_id` VARCHAR(191) NULL,
  `error_code` VARCHAR(60) NULL,
  `error_message` TEXT NULL,
  `error_safe` BOOLEAN NOT NULL DEFAULT false,
  `ambiguous` BOOLEAN NOT NULL DEFAULT false,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,

  UNIQUE INDEX `whatsapp_activity_attempt_activity_id_attempt_no_key`(`activity_id`, `attempt_no`),
  INDEX `whatsapp_activity_attempt_requested_by_user_id_idx`(`requested_by_user_id`),
  INDEX `whatsapp_activity_attempt_sender_user_id_idx`(`sender_user_id`),
  INDEX `whatsapp_activity_attempt_provider_message_id_idx`(`provider_message_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_initiated_by_user_id_fkey` FOREIGN KEY (`initiated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_sales_project_id_fkey` FOREIGN KEY (`sales_project_id`) REFERENCES `sales_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_crm_lead_id_fkey` FOREIGN KEY (`crm_lead_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_image_selection_project_id_fkey` FOREIGN KEY (`image_selection_project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_template_key_fkey` FOREIGN KEY (`template_key`) REFERENCES `message_template`(`key`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_image_selection_notification_id_fkey` FOREIGN KEY (`image_selection_notification_id`) REFERENCES `image_selection_whatsapp_notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity_attempt` ADD CONSTRAINT `whatsapp_activity_attempt_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `whatsapp_activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity_attempt` ADD CONSTRAINT `whatsapp_activity_attempt_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_activity_attempt` ADD CONSTRAINT `whatsapp_activity_attempt_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- `SETTINGS / WhatsApp Activity Log`: who may open the log and, with Read / Write, send a failed
-- message again. Here as a migration as well as in `seeds/permission-catalogue.js`, because the seed
-- cannot be run on production and a guard naming a permission the table does not hold refuses
-- everybody but a Super Admin. Granted to SUPER_ADMIN only; the studio grants it to other roles in
-- Role Management.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'WhatsApp Activity Log', 'SETTINGS_WHATSAPP_ACTIVITY', 'WhatsApp Activity Log',
       'Settings → User Settings → WhatsApp Activity Log: every WhatsApp message the app sent or tried to send, and with Read / Write the Resend of a failed one',
       1, NOW(3), NOW(3)
  FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'WhatsApp Activity Log' AND `existing`.`level` = 'SETTINGS_WHATSAPP_ACTIVITY'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'SETTINGS_WHATSAPP_ACTIVITY'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
