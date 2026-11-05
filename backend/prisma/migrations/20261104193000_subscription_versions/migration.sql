-- Update site: a live client's changes wait as pending until published, and each publish is a version.
ALTER TABLE `subscription_client`
  ADD COLUMN `live_version` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `pending_changes` JSON NULL,
  ADD COLUMN `published_at` DATETIME(3) NULL;

CREATE TABLE `subscription_version` (
    `id` VARCHAR(191) NOT NULL,
    `client_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_by` VARCHAR(50) NULL,

    UNIQUE INDEX `subscription_version_client_id_version_key`(`client_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `subscription_version` ADD CONSTRAINT `subscription_version_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `subscription_client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Accounts already set up count as their first version.
UPDATE `subscription_client` SET `live_version` = 1, `published_at` = `activated_at` WHERE `activated_at` IS NOT NULL;
INSERT INTO `subscription_version` (`id`, `client_id`, `version`, `snapshot`, `published_at`)
SELECT REPLACE(UUID(), '-', ''), `id`, 1,
  JSON_OBJECT('product', `product`, 'subdomain', `subdomain`, 'usersAllowed', `users_allowed`, 'adminUsername', `admin_username`,
              'validFrom', DATE_FORMAT(`valid_from`, '%Y-%m-%d'), 'validUntil', DATE_FORMAT(`valid_until`, '%Y-%m-%d'), 'modules', `modules`),
  `activated_at`
FROM `subscription_client` WHERE `activated_at` IS NOT NULL;
