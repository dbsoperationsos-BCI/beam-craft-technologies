-- Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted: when a client
-- submits their photo selection, one message into a WhatsApp group - its own switch, group name and
-- Priority 1 on the HR settings row beside the attendance report's and the wishes', which are not
-- touched. Each notification is a `whatsapp_activity` row, so no new table.
--
-- Cost: four columns on a one-row table, one template row, one permission row. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `photo_selection_notify_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `photo_selection_group_name` VARCHAR(500) NULL,
  ADD COLUMN `photo_selection_sender_user_id` INTEGER NULL,
  ADD COLUMN `photo_selection_last_error` TEXT NULL;

CREATE INDEX `hrm_settings_photo_selection_sender_user_id_idx` ON `hrm_settings`(`photo_selection_sender_user_id`);

ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_photo_selection_sender_user_id_fkey` FOREIGN KEY (`photo_selection_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The wording, edited in Settings → Automatic WhatsApp Message → Photo Selection Submitted (and in
-- Settings → Templates → Message Template). Placeholders: {client name}, {project name},
-- {event name}, {category breakdown} (one line per submitted item with its count),
-- {total selected count}, {deliverables}, {selected count}, {submitted at}. Written only when absent.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PHOTO_SELECTION_SUBMITTED', 'Photo Selection Submitted', 'Hi Team,

Photo selection submission received!

Project: {project name}
Client: {client name}
Event: {event name}

Submitted Categories:
{category breakdown}

Total Selected: {total selected count} photos
Submitted At: {submitted at}

Please proceed with the submitted deliverables in DBS-Operations-OS.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PHOTO_SELECTION_SUBMITTED');

-- `SETTINGS / Automatic WhatsApp Message`: the Photo Selection Submitted configuration. Granted to
-- SUPER_ADMIN only; the studio grants it to other roles in Role Management.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Automatic WhatsApp Message', 'SETTINGS_AUTOMATIC_WHATSAPP', 'Automatic WhatsApp Message',
       'Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted: whether a client''s submitted selection is announced in a WhatsApp group, which group and who sends it. Editing the wording also needs SETTINGS / Message Template Read / Write',
       1, NOW(3), NOW(3)
  FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Automatic WhatsApp Message' AND `existing`.`level` = 'SETTINGS_AUTOMATIC_WHATSAPP'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'SETTINGS_AUTOMATIC_WHATSAPP'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
