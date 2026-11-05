-- Automatic WhatsApp messages: for each one, a mode - SAME (one chosen sender first, then the other
-- Allow-WhatsApp employees in a dragged FALLBACK order) or ROTATE (taking turns through them in a
-- dragged ROTATION order) - in place of the one (or two) sender columns each message held. Every
-- sender already chosen is carried over as the SAME sender, and leads the rotation order; the shoot
-- crew notice's Priority 2 heads its fallback order and follows in its rotation. Then the old
-- columns go.

CREATE TABLE `whatsapp_sender_policy` (
    `message_key` VARCHAR(40) NOT NULL,
    `mode` ENUM('SAME', 'ROTATE') NOT NULL DEFAULT 'SAME',
    `sender_user_id` INTEGER NULL,
    `last_sender_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `whatsapp_sender_policy_sender_user_id_idx`(`sender_user_id`),
    INDEX `whatsapp_sender_policy_last_sender_user_id_idx`(`last_sender_user_id`),
    PRIMARY KEY (`message_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_sender_policy_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_key` VARCHAR(40) NOT NULL,
    `list` ENUM('FALLBACK', 'ROTATION') NOT NULL DEFAULT 'ROTATION',
    `user_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,

    INDEX `whatsapp_sender_policy_member_user_id_idx`(`user_id`),
    UNIQUE INDEX `whatsapp_sender_policy_member_message_key_list_user_id_key`(`message_key`, `list`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `whatsapp_sender_policy` ADD CONSTRAINT `whatsapp_sender_policy_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_sender_policy` ADD CONSTRAINT `whatsapp_sender_policy_last_sender_user_id_fkey` FOREIGN KEY (`last_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `whatsapp_sender_policy_member` ADD CONSTRAINT `whatsapp_sender_policy_member_message_key_fkey` FOREIGN KEY (`message_key`) REFERENCES `whatsapp_sender_policy`(`message_key`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `whatsapp_sender_policy_member` ADD CONSTRAINT `whatsapp_sender_policy_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the senders already chosen: one policy row per message that has one, then the start of
-- its rotation order.
INSERT INTO `whatsapp_sender_policy` (`message_key`, `mode`, `sender_user_id`, `updated_at`)
SELECT 'ATTENDANCE_REPORT', 'SAME', `attendance_report_sender_user_id`, CURRENT_TIMESTAMP(3) FROM `hrm_settings` WHERE `id` = 'default' AND `attendance_report_sender_user_id` IS NOT NULL
UNION ALL SELECT 'WISHES', 'SAME', `wishes_sender_user_id`, CURRENT_TIMESTAMP(3) FROM `hrm_settings` WHERE `id` = 'default' AND `wishes_sender_user_id` IS NOT NULL
UNION ALL SELECT 'PHOTO_SELECTION_SUBMITTED', 'SAME', `photo_selection_sender_user_id`, CURRENT_TIMESTAMP(3) FROM `hrm_settings` WHERE `id` = 'default' AND `photo_selection_sender_user_id` IS NOT NULL
UNION ALL SELECT 'INTERVIEW_WELCOME', 'SAME', `interview_welcome_sender_user_id`, CURRENT_TIMESTAMP(3) FROM `hrm_settings` WHERE `id` = 'default' AND `interview_welcome_sender_user_id` IS NOT NULL
UNION ALL SELECT 'PAYMENT_REMINDER', 'SAME', `payment_reminder_sender_user_id`, CURRENT_TIMESTAMP(3) FROM `payment_reminder_settings` WHERE `id` = 'default' AND `payment_reminder_sender_user_id` IS NOT NULL
UNION ALL SELECT 'SHOOT_CREW_NOTICE', 'SAME', COALESCE(`sender_one_user_id`, `sender_two_user_id`), CURRENT_TIMESTAMP(3) FROM `shoot_crew_notice_settings` WHERE `id` = 'default' AND (`sender_one_user_id` IS NOT NULL OR `sender_two_user_id` IS NOT NULL);

INSERT INTO `whatsapp_sender_policy_member` (`message_key`, `user_id`, `position`)
SELECT 'ATTENDANCE_REPORT', `attendance_report_sender_user_id`, 1 FROM `hrm_settings` WHERE `id` = 'default' AND `attendance_report_sender_user_id` IS NOT NULL
UNION ALL SELECT 'WISHES', `wishes_sender_user_id`, 1 FROM `hrm_settings` WHERE `id` = 'default' AND `wishes_sender_user_id` IS NOT NULL
UNION ALL SELECT 'PHOTO_SELECTION_SUBMITTED', `photo_selection_sender_user_id`, 1 FROM `hrm_settings` WHERE `id` = 'default' AND `photo_selection_sender_user_id` IS NOT NULL
UNION ALL SELECT 'INTERVIEW_WELCOME', `interview_welcome_sender_user_id`, 1 FROM `hrm_settings` WHERE `id` = 'default' AND `interview_welcome_sender_user_id` IS NOT NULL
UNION ALL SELECT 'PAYMENT_REMINDER', `payment_reminder_sender_user_id`, 1 FROM `payment_reminder_settings` WHERE `id` = 'default' AND `payment_reminder_sender_user_id` IS NOT NULL
UNION ALL SELECT 'SHOOT_CREW_NOTICE', `sender_one_user_id`, 1 FROM `shoot_crew_notice_settings` WHERE `id` = 'default' AND `sender_one_user_id` IS NOT NULL
-- Priority 2 stays second - or, with no Priority 1, leads alone.
UNION ALL SELECT 'SHOOT_CREW_NOTICE', `sender_two_user_id`, CASE WHEN `sender_one_user_id` IS NULL THEN 1 ELSE 2 END FROM `shoot_crew_notice_settings`
  WHERE `id` = 'default' AND `sender_two_user_id` IS NOT NULL AND (`sender_one_user_id` IS NULL OR `sender_two_user_id` <> `sender_one_user_id`);

-- The shoot crew notice's Priority 2 is the first tried when its Sender (Priority 1) cannot send.
INSERT INTO `whatsapp_sender_policy_member` (`message_key`, `list`, `user_id`, `position`)
SELECT 'SHOOT_CREW_NOTICE', 'FALLBACK', `sender_two_user_id`, 1 FROM `shoot_crew_notice_settings`
  WHERE `id` = 'default' AND `sender_one_user_id` IS NOT NULL AND `sender_two_user_id` IS NOT NULL AND `sender_two_user_id` <> `sender_one_user_id`;

-- The old sender columns.
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_attendance_report_sender_user_id_fkey`;
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_attendance_report_sender2_user_id_fkey`;
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_attendance_report_sender3_user_id_fkey`;
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_wishes_sender_user_id_fkey`;
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_photo_selection_sender_user_id_fkey`;
ALTER TABLE `hrm_settings` DROP FOREIGN KEY `hrm_settings_interview_welcome_sender_user_id_fkey`;
ALTER TABLE `payment_reminder_settings` DROP FOREIGN KEY `payment_reminder_settings_payment_reminder_sender_user_id_fkey`;
ALTER TABLE `shoot_crew_notice_settings` DROP FOREIGN KEY `shoot_crew_notice_settings_sender_one_user_id_fkey`;
ALTER TABLE `shoot_crew_notice_settings` DROP FOREIGN KEY `shoot_crew_notice_settings_sender_two_user_id_fkey`;

ALTER TABLE `hrm_settings`
    DROP INDEX `hrm_settings_attendance_report_sender_user_id_idx`,
    DROP INDEX `hrm_settings_attendance_report_sender2_user_id_idx`,
    DROP INDEX `hrm_settings_attendance_report_sender3_user_id_idx`,
    DROP INDEX `hrm_settings_wishes_sender_user_id_idx`,
    DROP INDEX `hrm_settings_photo_selection_sender_user_id_idx`,
    DROP INDEX `hrm_settings_interview_welcome_sender_user_id_idx`,
    DROP COLUMN `attendance_report_sender_user_id`,
    DROP COLUMN `attendance_report_sender2_user_id`,
    DROP COLUMN `attendance_report_sender3_user_id`,
    DROP COLUMN `wishes_sender_user_id`,
    DROP COLUMN `photo_selection_sender_user_id`,
    DROP COLUMN `interview_welcome_sender_user_id`;

ALTER TABLE `payment_reminder_settings`
    DROP INDEX `payment_reminder_settings_payment_reminder_sender_user_id_idx`,
    DROP COLUMN `payment_reminder_sender_user_id`;

ALTER TABLE `shoot_crew_notice_settings`
    DROP INDEX `shoot_crew_notice_settings_sender_one_user_id_idx`,
    DROP INDEX `shoot_crew_notice_settings_sender_two_user_id_idx`,
    DROP COLUMN `sender_one_user_id`,
    DROP COLUMN `sender_two_user_id`;
