-- Client offers in two places (Sales -> Client Offers, two tabs): `home` on the Home page of the
-- clients' app, as every offer so far, and `referral` on its Referrals page - the studio's referral
-- offer ("refer a friend and get ..."). The referral offers take the place of the single Referrals
-- poster in Client app settings, so its columns go.
--
-- Every existing offer stays on Home (the default); the poster columns were added earlier today and
-- have never held anything outside a developer's machine.

ALTER TABLE `client_offer` ADD COLUMN `placement` VARCHAR(20) NOT NULL DEFAULT 'home';
CREATE INDEX `client_offer_placement_idx` ON `client_offer`(`placement`, `is_active`, `deleted_at`);

ALTER TABLE `client_app_setting`
  DROP COLUMN `referral_banner_url`,
  DROP COLUMN `referral_banner_key`,
  DROP COLUMN `referral_banner_width`,
  DROP COLUMN `referral_banner_height`;
