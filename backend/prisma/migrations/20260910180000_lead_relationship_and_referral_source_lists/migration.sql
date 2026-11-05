-- Relationship and Referred From become lists the studio maintains, under Settings -> Field
-- Settings -> Quotation.
--
-- Both are asked for wherever a lead's details are taken down: SALES -> CRM -> Add Lead, the lead
-- popup, and the Quotation Generator's Client Details. Both are typed-with-suggestions fields - the
-- list is there so the common answers are spelled one way, and anything else can still be typed -
-- and both lists were written out twice, once in CRMPage.js and once in quotationVerticalConfig.js,
-- where no studio could add a source of its own. Two tables, read by both screens.
--
-- Seeded with exactly what the two arrays held, so nothing a lead already answered stops matching a
-- list. Each seed fills only an empty table. Written by hand and applied with
-- `prisma migrate deploy`; index names stay inside MySQL's 64-character limit.

CREATE TABLE `lead_relationship` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `lead_relationship_code_key`(`code`),
  INDEX `lead_relationship_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referral_source` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `referral_source_code_key`(`code`),
  INDEX `referral_source_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- How the person enquiring relates to the couple, the child or the company - which is why Self,
-- Bride, Wedding Planner and Event Manager are here and a close-family list would not have them.
INSERT INTO `lead_relationship` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'SELF' AS `code`, 'Self' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'BRIDE', 'Bride', NOW(3)
  UNION ALL SELECT 'GROOM', 'Groom', NOW(3)
  UNION ALL SELECT 'FATHER', 'Father', NOW(3)
  UNION ALL SELECT 'MOTHER', 'Mother', NOW(3)
  UNION ALL SELECT 'BROTHER', 'Brother', NOW(3)
  UNION ALL SELECT 'SISTER', 'Sister', NOW(3)
  UNION ALL SELECT 'SON', 'Son', NOW(3)
  UNION ALL SELECT 'DAUGHTER', 'Daughter', NOW(3)
  UNION ALL SELECT 'HUSBAND', 'Husband', NOW(3)
  UNION ALL SELECT 'WIFE', 'Wife', NOW(3)
  UNION ALL SELECT 'UNCLE', 'Uncle', NOW(3)
  UNION ALL SELECT 'AUNT', 'Aunt', NOW(3)
  UNION ALL SELECT 'COUSIN', 'Cousin', NOW(3)
  UNION ALL SELECT 'FRIEND', 'Friend', NOW(3)
  UNION ALL SELECT 'RELATIVE', 'Relative', NOW(3)
  UNION ALL SELECT 'COLLEAGUE', 'Colleague', NOW(3)
  UNION ALL SELECT 'WEDDING_PLANNER', 'Wedding Planner', NOW(3)
  UNION ALL SELECT 'EVENT_MANAGER', 'Event Manager', NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `lead_relationship` `existing`);

-- Where the enquiry came from.
INSERT INTO `referral_source` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'INSTAGRAM' AS `code`, 'Instagram' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'WHATSAPP', 'WhatsApp', NOW(3)
  UNION ALL SELECT 'FACEBOOK', 'Facebook', NOW(3)
  UNION ALL SELECT 'GOOGLE', 'Google', NOW(3)
  UNION ALL SELECT 'GOOGLE_ADS', 'Google Ads', NOW(3)
  UNION ALL SELECT 'YOUTUBE', 'YouTube', NOW(3)
  UNION ALL SELECT 'WEBSITE', 'Website', NOW(3)
  UNION ALL SELECT 'WALK_IN', 'Walk-in', NOW(3)
  UNION ALL SELECT 'PHONE_ENQUIRY', 'Phone Enquiry', NOW(3)
  UNION ALL SELECT 'REFERRAL', 'Referral', NOW(3)
  UNION ALL SELECT 'FRIEND', 'Friend', NOW(3)
  UNION ALL SELECT 'FAMILY', 'Family', NOW(3)
  UNION ALL SELECT 'EXISTING_CLIENT', 'Existing Client', NOW(3)
  UNION ALL SELECT 'WEDDING_PLANNER', 'Wedding Planner', NOW(3)
  UNION ALL SELECT 'EXHIBITION', 'Exhibition', NOW(3)
  UNION ALL SELECT 'HOARDING', 'Hoarding', NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `referral_source` `existing`);
