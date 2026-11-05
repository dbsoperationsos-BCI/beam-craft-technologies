-- The client site's API: its key (only the SHA-256 hash is kept), and when Beam Craft last made the Admin's password.
ALTER TABLE `subscription_client`
  ADD COLUMN `site_key_hash` CHAR(64) NULL,
  ADD COLUMN `admin_password_set_at` DATETIME(3) NULL;

-- Accounts already set up had their password made at setup.
UPDATE `subscription_client` SET `admin_password_set_at` = `activated_at`
WHERE `activated_at` IS NOT NULL AND `admin_password_hash` IS NOT NULL;
