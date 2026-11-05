-- Offers the studio shows its clients on the Home page of their app (Sales -> Client Offers).
--
-- A new table only: nothing existing is changed, so there is nothing to fail on production data.

CREATE TABLE `client_offer` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tag` VARCHAR(40) NULL,
  `title` VARCHAR(120) NOT NULL,
  `note` VARCHAR(300) NULL,
  `image_url` TEXT NULL,
  `image_key` VARCHAR(255) NULL,
  `tone` VARCHAR(10) NOT NULL DEFAULT 'dark',
  `valid_from` DATE NULL,
  `valid_until` DATE NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` INTEGER NULL,
  `updated_by` INTEGER NULL,
  `deleted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `client_offer_live_idx`(`is_active`, `deleted_at`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
