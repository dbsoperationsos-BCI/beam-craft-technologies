-- The shoots a brand quotes for, moved out of the code and onto a table the studio can edit.
--
-- It was the constant `BRAND_SHOOTS` in `quotation-brands/defaults.js`: fourteen shoots for Dum Dum,
-- thirteen for Qua Qua, two for Corp. The picture sets in Quotation Settings were chosen from it and
-- nothing else read it, so a studio that started doing a new kind of shoot under a brand had no way
-- to say so short of a code change.
--
-- Each brand's list is its own. The studio names the shoots it quotes for under each brand rather
-- than ticking them off one shared vocabulary — which is a change worth knowing about: a quotation
-- can now name a shoot that Project Management's own Add Shoot does not offer. In practice a project
-- takes its shoots from the quotation that sold it, so the two still agree; a project raised with no
-- quotation behind it still offers the studio's own list.
--
-- Seeded with exactly what the constant held, so every brand opens with the shoots it already had
-- and no picture set loses the shoots it was built from. Written by hand and applied with
-- `prisma migrate deploy`; index names are kept well inside MySQL's 64-character limit.

CREATE TABLE `sales_quotation_brand_shoot` (
  `id` VARCHAR(191) NOT NULL,
  `brand_code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `sqb_shoot_brand_name_key`(`brand_code`, `name`),
  INDEX `sqb_shoot_brand_active_sort_idx`(`brand_code`, `is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales_quotation_brand_shoot`
  ADD CONSTRAINT `sqb_shoot_brand_fk` FOREIGN KEY (`brand_code`)
  REFERENCES `sales_quotation_brand`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- What `BRAND_SHOOTS` held, in the order it held it. Only while the table is empty, so re-running
-- this cannot duplicate a studio's own edits or put back a shoot they removed on purpose.
INSERT INTO `sales_quotation_brand_shoot` (`id`, `brand_code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT UUID() AS `id`, 'DUM_DUM' AS `brand_code`, 'Bride Haldi' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Groom Haldi', 1, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Bride Making', 2, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Groom Making', 3, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Engagement', 4, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Haldi', 5, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Mehandi', 6, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Post Wedding', 7, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Pre Wedding', 8, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Couple Shoot IH', 9, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Reception', 10, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Sangeeth', 11, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Wedding', 12, NOW(3)
  UNION ALL SELECT UUID(), 'DUM_DUM', 'Wedding + Reception', 13, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Baby Shoot IH', 0, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Baby Shoot OH', 1, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Baby Shoot_CP', 2, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Baby Shower', 3, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Birthday Shoot', 4, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Ear Piercing', 5, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Maternity CP', 6, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Maternity IH', 7, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Maternity OH', 8, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Naming ceremony', 9, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'New Born', 10, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Puberty Function', 11, NOW(3)
  UNION ALL SELECT UUID(), 'QUA_QUA', 'Puberty Outdoor', 12, NOW(3)
  UNION ALL SELECT UUID(), 'CORP', 'Corporate', 0, NOW(3)
  UNION ALL SELECT UUID(), 'CORP', 'Industrial', 1, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `sales_quotation_brand_shoot` `existing`);
