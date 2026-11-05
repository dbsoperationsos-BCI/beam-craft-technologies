-- Client chats: a client's conversation with the studio from their app, one per topic they open
-- (Pre Production, Payment, Production, Shoot details, Quotation, Other), answered by the team on
-- Sales -> Client Chats. New tables, and the `SALES / Client Chats` permission (Read to see the chats,
-- Read / Write to answer), granted Read / Write to SUPER_ADMIN only.
--
-- Nothing existing is changed, so there is nothing to fail on production data.

CREATE TABLE `client_chat_thread` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `project_id` VARCHAR(191) NOT NULL,
  `client_user_id` INTEGER NULL,
  `topic` VARCHAR(30) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'open',
  `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `client_read_at` DATETIME(3) NULL,
  `staff_read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `client_chat_thread_project_idx`(`project_id`, `last_message_at`),
  INDEX `client_chat_thread_last_idx`(`last_message_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `client_chat_message` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `thread_id` INTEGER NOT NULL,
  `from_client` BOOLEAN NOT NULL,
  `author_user_id` INTEGER NULL,
  `author_name` VARCHAR(191) NULL,
  `body` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `client_chat_message_thread_idx`(`thread_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `client_chat_message_thread_fk` FOREIGN KEY (`thread_id`) REFERENCES `client_chat_thread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Client Chats', 'CLIENT_CHAT_MANAGE', 'Client Chats', 'The chats clients start from their app: read them (Read), and answer them (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SALES' AND `existing`.`feature` = 'Client Chats' AND `existing`.`level` = 'CLIENT_CHAT_MANAGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SALES' AND `permission`.`feature` = 'Client Chats' AND `permission`.`level` = 'CLIENT_CHAT_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
