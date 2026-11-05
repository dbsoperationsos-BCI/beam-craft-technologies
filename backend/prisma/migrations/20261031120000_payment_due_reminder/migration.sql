-- Settings → Project Management → Payment reminder: two days before a scheduled payment falls due,
-- a WhatsApp reminder goes into the project's own group, from the one person chosen there, at the
-- time set there (10:00 am India time unless set). Only a payment still to be received is reminded.
--
-- The studio's one row for the reminder - a table of its own, apart from the Project Management
-- settings table Post Production's branch creates. Nothing sends until a sender is chosen.
CREATE TABLE `payment_reminder_settings` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `payment_reminder_sender_user_id` INTEGER NULL,
    `payment_reminder_send_at` VARCHAR(5) NULL,
    `payment_reminder_last_attempt_at` DATETIME(3) NULL,
    `payment_reminder_last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payment_reminder_settings_payment_reminder_sender_user_id_idx`(`payment_reminder_sender_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_reminder_settings` ADD CONSTRAINT `payment_reminder_settings_payment_reminder_sender_user_id_fkey` FOREIGN KEY (`payment_reminder_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The due date each payment's reminder went out for, so it is sent once per date - and once more
-- if the payment is moved. Null on every existing row: nothing has been reminded yet.
ALTER TABLE `project_payment_schedule`
    ADD COLUMN `reminder_sent_for` DATETIME(3) NULL,
    ADD COLUMN `reminder_sent_at` DATETIME(3) NULL;

-- The reminder's wording, edited in Settings → Message Templates → Payment Reminder.
-- `WHERE NOT EXISTS` so a replay loses nothing the studio wrote.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PAYMENT_DUE_REMINDER', 'Payment Reminder', 'Hi {client name}, a gentle reminder that your {payment} of {amount} for {event id} is due on {due date}. Thank you!'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PAYMENT_DUE_REMINDER');

-- `SETTINGS / Payment Reminder`, the permission the section and its endpoints answer to. Written
-- here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on production
-- (IAM.md step 10).
--
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for any other role that
-- should see or set the payment reminder, and re-save them.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Payment Reminder', 'SETTINGS_PAYMENT_REMINDER', 'Payment Reminder',
       'Settings → Project Management → Payment reminder: who sends the WhatsApp reminder two days before a payment is due, and when',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Payment Reminder' AND `existing`.`level` = 'SETTINGS_PAYMENT_REMINDER'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Payment Reminder' AND `permission`.`level` = 'SETTINGS_PAYMENT_REMINDER'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
