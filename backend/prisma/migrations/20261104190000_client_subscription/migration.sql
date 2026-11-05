-- The account Beam Craft sets up for a client: where it logs in, how many users, its Admin, validity, modules.
ALTER TABLE `subscription_client`
  ADD COLUMN `subdomain` VARCHAR(40) NULL,
  ADD COLUMN `users_allowed` INTEGER NULL,
  ADD COLUMN `admin_username` VARCHAR(60) NULL,
  ADD COLUMN `admin_password_hash` VARCHAR(100) NULL,
  ADD COLUMN `valid_from` DATE NULL,
  ADD COLUMN `valid_until` DATE NULL,
  ADD COLUMN `modules` JSON NULL,
  ADD COLUMN `activated_at` DATETIME(3) NULL;
CREATE UNIQUE INDEX `subscription_client_subdomain_key` ON `subscription_client`(`subdomain`);
