-- Invitation Cards: animated invitations a client makes in their app for one of their shoots, from a
-- design the studio adds on Client Management -> Invitation Cards, with ten seconds of a song the
-- studio uploads there; guests open it at `/i/<token>`.
--
-- Three new tables and the `CLIENT / Invitation Cards` permission (Read to see the designs and songs,
-- Read / Write to change them), granted Read / Write to SUPER_ADMIN only. Nothing existing is changed,
-- so there is nothing to fail on production data.

CREATE TABLE `invitation_template` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(120) NOT NULL,
    `shoot_types` JSON NOT NULL,
    `style` VARCHAR(30) NOT NULL DEFAULT 'royal',
    `accent` VARCHAR(9) NULL,
    `cover_url` TEXT NULL,
    `cover_key` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `invitation_template_live_idx`(`is_active`, `deleted_at`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitation_song` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(120) NOT NULL,
    `artist` VARCHAR(120) NULL,
    `audio_url` TEXT NOT NULL,
    `audio_key` VARCHAR(255) NULL,
    `shoot_types` JSON NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `invitation_song_live_idx`(`is_active`, `deleted_at`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_invitation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(24) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `song_id` INTEGER NULL,
    `song_start` INTEGER NOT NULL DEFAULT 0,
    `shoot_name` VARCHAR(191) NOT NULL,
    `content` JSON NOT NULL,
    `photo_url` TEXT NULL,
    `photo_key` VARCHAR(255) NULL,
    `created_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_invitation_token_key`(`token`),
    INDEX `client_invitation_project_idx`(`project_id`, `deleted_at`),
    INDEX `client_invitation_template_idx`(`template_id`),
    INDEX `client_invitation_song_idx`(`song_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `client_invitation` ADD CONSTRAINT `client_invitation_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `client_invitation` ADD CONSTRAINT `client_invitation_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `invitation_template`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `client_invitation` ADD CONSTRAINT `client_invitation_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `invitation_song`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'CLIENT', 'Invitation Cards', 'INVITATION_CARD_MANAGE', 'Invitation Cards', 'The invitation designs and songs clients choose from in their app: see them (Read), and add, change or remove them (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'CLIENT' AND `existing`.`feature` = 'Invitation Cards' AND `existing`.`level` = 'INVITATION_CARD_MANAGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'CLIENT' AND `permission`.`feature` = 'Invitation Cards' AND `permission`.`level` = 'INVITATION_CARD_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
