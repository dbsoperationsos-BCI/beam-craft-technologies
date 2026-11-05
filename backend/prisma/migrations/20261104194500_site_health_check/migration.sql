-- Health monitoring: each check of a live client's site.
CREATE TABLE `site_health_check` (
    `id` VARCHAR(191) NOT NULL,
    `client_id` VARCHAR(191) NOT NULL,
    `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ok` BOOLEAN NOT NULL,
    `status_code` INTEGER NULL,
    `response_ms` INTEGER NULL,
    `version` VARCHAR(40) NULL,
    `error` VARCHAR(300) NULL,

    INDEX `site_health_check_client_id_checked_at_idx`(`client_id`, `checked_at`),
    INDEX `site_health_check_checked_at_idx`(`checked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `site_health_check` ADD CONSTRAINT `site_health_check_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `subscription_client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
