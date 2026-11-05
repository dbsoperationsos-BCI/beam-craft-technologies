-- Referral rewards and the client app's settings (Sales -> Client Offers -> Client app settings).
--
-- `client_app_setting` is one row: the WhatsApp number the clients' offers are asked about on, how
-- many coins a client earns when somebody they referred books, and the poster on the app's Referrals
-- page. `client_coin_entry` is each client's coins, one row per referral that turned into a booking
-- (unique on the referral, so it is never paid twice), on the client's own project.
--
-- New tables only, so there is nothing to fail on production data. The one settings row starts with
-- the studio's office WhatsApp number and 20 coins a booking; both are changed on Client Offers.

CREATE TABLE `client_app_setting` (
  `id` INTEGER NOT NULL,
  `offers_whatsapp` VARCHAR(20) NULL,
  `coins_per_booking` INTEGER NOT NULL DEFAULT 20,
  `referral_banner_url` TEXT NULL,
  `referral_banner_key` VARCHAR(255) NULL,
  `referral_banner_width` INTEGER NULL,
  `referral_banner_height` INTEGER NULL,
  `updated_by` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `client_app_setting` (`id`, `offers_whatsapp`, `coins_per_booking`) VALUES (1, '+91 9442648610', 20);

CREATE TABLE `client_coin_entry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `project_id` VARCHAR(191) NOT NULL,
  `referral_enquiry_id` VARCHAR(191) NOT NULL,
  `referral_name` VARCHAR(120) NULL,
  `coins` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `client_coin_entry_referral_key`(`referral_enquiry_id`),
  INDEX `client_coin_entry_project_idx`(`project_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `client_coin_entry_project_fk` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
