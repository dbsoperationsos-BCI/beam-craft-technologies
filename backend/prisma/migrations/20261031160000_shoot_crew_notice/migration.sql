-- Settings → Project Management → Shoot crew notice: a WhatsApp message to each person given a
-- service on a shoot, two days before it - what the shoot is, when, where, and the service they are
-- on - and again to anybody whose seat changes after that. Off by default, so nothing is sent until
-- the studio switches it on and picks the senders.
--
-- Cost: two new tables, the permission, and the two wordings inserted only where the studio has not
-- written one (`WHERE NOT EXISTS`). Nothing existing is read or rewritten.

CREATE TABLE `shoot_crew_notice_settings` (
  `id` VARCHAR(30) NOT NULL DEFAULT 'default',
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `sender_one_user_id` INTEGER NULL,
  `sender_two_user_id` INTEGER NULL,
  `sender_fallback_user_id` INTEGER NULL,
  `last_attempt_at` DATETIME(3) NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `shoot_crew_notice_settings_sender_one_user_id_idx`(`sender_one_user_id`),
  INDEX `shoot_crew_notice_settings_sender_two_user_id_idx`(`sender_two_user_id`),
  INDEX `shoot_crew_notice_settings_sender_fallback_user_id_idx`(`sender_fallback_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_shoot_crew_notice` (
  `id` VARCHAR(191) NOT NULL,
  `production_id` VARCHAR(191) NOT NULL,
  `employee_id` INTEGER NOT NULL,
  `service_definition_id` VARCHAR(191) NULL,
  `digest` VARCHAR(64) NOT NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `project_shoot_crew_notice_production_id_employee_id_key`(`production_id`, `employee_id`),
  INDEX `project_shoot_crew_notice_employee_id_idx`(`employee_id`),
  INDEX `project_shoot_crew_notice_service_definition_id_idx`(`service_definition_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shoot_crew_notice_settings` ADD CONSTRAINT `shoot_crew_notice_settings_sender_one_user_id_fkey` FOREIGN KEY (`sender_one_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `shoot_crew_notice_settings` ADD CONSTRAINT `shoot_crew_notice_settings_sender_two_user_id_fkey` FOREIGN KEY (`sender_two_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `shoot_crew_notice_settings` ADD CONSTRAINT `shoot_crew_notice_settings_sender_fallback_user_id_fkey` FOREIGN KEY (`sender_fallback_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `project_shoot_crew_notice` ADD CONSTRAINT `project_shoot_crew_notice_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_shoot_crew_notice` ADD CONSTRAINT `project_shoot_crew_notice_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_shoot_crew_notice` ADD CONSTRAINT `project_shoot_crew_notice_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The permission. Granted to SUPER_ADMIN only; every other role starts at DISABLED and the studio
-- grants it in Role Management.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Shoot Crew Notice', 'SETTINGS_SHOOT_CREW_NOTICE', 'Shoot Crew Notice',
       'Settings → Project Management → Shoot crew notice: whether each shoot''s crew is told about it on WhatsApp, and who sends it',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Shoot Crew Notice' AND `existing`.`level` = 'SETTINGS_SHOOT_CREW_NOTICE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Shoot Crew Notice' AND `permission`.`level` = 'SETTINGS_SHOOT_CREW_NOTICE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'SHOOT_CREW_ASSIGNED', 'Shoot Crew Notice', 'Hi {employee name},

You are on a shoot.

Shoot: {shoot}
Project: {project}
Date: {date} ({day})
Time: {time}
Place: {place}
District: {district}
Your service: {service}

Please be ready on time. Reach out to {coordinator} for anything you need.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'SHOOT_CREW_ASSIGNED');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'SHOOT_CREW_REMOVED', 'Shoot Crew Removed', 'Hi {employee name},

You are no longer on this shoot.

Shoot: {shoot}
Project: {project}
Date: {date} ({day})

Please do not travel for it. {coordinator} will let you know if anything changes.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'SHOOT_CREW_REMOVED');
