-- A deliverable is sold by several companies, in several variants each, and its three common
-- questions are answered in words.
--
-- Two changes, together because they are one form's worth of change:
--
-- 1. Deliverable -> Type -> Brand (many) -> Variant (many). A deliverable held one company, one
--    size, one frame, one length and one price, which is not how they are sold: the same album is
--    sold by Canvera and by Pictoo, each in several sizes at several prices. Two tables hold them,
--    owned entirely by the deliverable - `ON DELETE CASCADE` both ways - and rewritten whole on
--    every save. What a variant carries follows the deliverable's type and nothing else: an image's
--    `size` and `frame_inches`, a video's `video_length`, and a `price` for both.
--
--    The deliverable's own `brand_name`, `image_size`, `video_length`, `frame_inches` and `price`
--    stay exactly where they are and are rewritten from the first brand's first variant on every
--    save. The CRM Quotation Calculator quotes one figure per deliverable and reads them, so
--    removing them would have changed a screen this change is not about. Every deliverable already
--    holding any of them is backfilled below into the one brand and one variant it describes, so
--    the dialog opens on what the studio already typed rather than on an empty form.
--
-- 2. `photo_count_enabled`, `image_selection_enabled` and `remarks_enabled` become text. They were
--    a Yes/No dropdown each and are typed now, so a studio can write what it actually does - "50
--    photos", "2 sets", "only the album". They still decide things, by the rule
--    `backend/src/services/deliverableAnswers.js` holds: an answer starting with "no" is No,
--    anything else typed is Yes, blank is unanswered. TRUE is written out as 'Yes' and FALSE as
--    'No' rather than as MySQL's own '1' and '0', so every row reads as the word it was chosen as
--    and nothing changes meaning - in particular no deliverable enters or leaves Image Selection.
--
-- Written by hand and applied with `prisma migrate deploy`; index names are kept well inside
-- MySQL's 64-character limit.

-- --------------------------------------------------------------------------------------------
-- 1. The three answers become words, keeping the Yes and No they were chosen as.
-- --------------------------------------------------------------------------------------------

ALTER TABLE `project_deliverable_definition`
  ADD COLUMN `photo_count_enabled_text` VARCHAR(191) NULL AFTER `photo_count_enabled`,
  ADD COLUMN `image_selection_enabled_text` VARCHAR(191) NULL AFTER `image_selection_enabled`,
  ADD COLUMN `remarks_enabled_text` TEXT NULL AFTER `remarks_enabled`;

UPDATE `project_deliverable_definition` SET
  `photo_count_enabled_text` = CASE WHEN `photo_count_enabled` = 1 THEN 'Yes' WHEN `photo_count_enabled` = 0 THEN 'No' ELSE NULL END,
  `image_selection_enabled_text` = CASE WHEN `image_selection_enabled` = 1 THEN 'Yes' WHEN `image_selection_enabled` = 0 THEN 'No' ELSE NULL END,
  `remarks_enabled_text` = CASE WHEN `remarks_enabled` = 1 THEN 'Yes' WHEN `remarks_enabled` = 0 THEN 'No' ELSE NULL END;

ALTER TABLE `project_deliverable_definition`
  DROP COLUMN `photo_count_enabled`,
  DROP COLUMN `image_selection_enabled`,
  DROP COLUMN `remarks_enabled`;

ALTER TABLE `project_deliverable_definition`
  CHANGE COLUMN `photo_count_enabled_text` `photo_count_enabled` VARCHAR(191) NULL,
  CHANGE COLUMN `image_selection_enabled_text` `image_selection_enabled` VARCHAR(191) NULL,
  CHANGE COLUMN `remarks_enabled_text` `remarks_enabled` TEXT NULL;

-- --------------------------------------------------------------------------------------------
-- 2. The brands a deliverable is sold by, and the variants each is sold in.
-- --------------------------------------------------------------------------------------------

CREATE TABLE `project_deliverable_brand` (
  `id` VARCHAR(191) NOT NULL,
  `definition_id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL DEFAULT '',
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `pd_brand_definition_sort_idx`(`definition_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_deliverable_brand`
  ADD CONSTRAINT `pd_brand_definition_fk` FOREIGN KEY (`definition_id`)
  REFERENCES `project_deliverable_definition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `project_deliverable_variant` (
  `id` VARCHAR(191) NOT NULL,
  `brand_id` VARCHAR(191) NOT NULL,
  `size` VARCHAR(100) NULL,
  `frame_inches` VARCHAR(60) NULL,
  `video_length` VARCHAR(100) NULL,
  `price` DECIMAL(12, 2) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `pd_variant_brand_sort_idx`(`brand_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_deliverable_variant`
  ADD CONSTRAINT `pd_variant_brand_fk` FOREIGN KEY (`brand_id`)
  REFERENCES `project_deliverable_brand`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------------------------
-- 3. What each deliverable already held, as the one brand and one variant it describes.
-- --------------------------------------------------------------------------------------------
--
-- Only deliverables carrying something worth carrying over, and only while the table is empty, so
-- re-running this cannot duplicate a brand or put back one somebody removed on purpose. The brand's
-- id is derived from the deliverable's so the variant below can find it without a second pass.

INSERT INTO `project_deliverable_brand` (`id`, `definition_id`, `name`, `sort_order`, `updated_at`)
SELECT CONCAT('bkf', `definition`.`id`), `definition`.`id`, COALESCE(`definition`.`brand_name`, ''), 0, NOW(3)
FROM `project_deliverable_definition` `definition`
WHERE (
  COALESCE(`definition`.`brand_name`, '') <> ''
  OR COALESCE(`definition`.`image_size`, '') <> ''
  OR COALESCE(`definition`.`video_length`, '') <> ''
  OR COALESCE(`definition`.`frame_inches`, '') <> ''
  OR `definition`.`price` IS NOT NULL
)
AND NOT EXISTS (SELECT 1 FROM `project_deliverable_brand` `existing`);

-- The variant carries only what the deliverable's own type asked for, exactly as a save does now:
-- an image's size and frame, a video's length. A deliverable whose type was never answered keeps
-- both, because nothing has decided yet which of them it is.
INSERT INTO `project_deliverable_variant` (`id`, `brand_id`, `size`, `frame_inches`, `video_length`, `price`, `sort_order`, `updated_at`)
SELECT CONCAT('vkf', `definition`.`id`), `brand`.`id`,
  CASE WHEN COALESCE(`definition`.`media_type`, '') = 'VIDEO' THEN NULL ELSE `definition`.`image_size` END,
  CASE WHEN COALESCE(`definition`.`media_type`, '') = 'VIDEO' THEN NULL ELSE `definition`.`frame_inches` END,
  CASE WHEN COALESCE(`definition`.`media_type`, '') = 'IMAGE' THEN NULL ELSE `definition`.`video_length` END,
  `definition`.`price`, 0, NOW(3)
FROM `project_deliverable_brand` `brand`
JOIN `project_deliverable_definition` `definition` ON `definition`.`id` = `brand`.`definition_id`
WHERE `brand`.`id` = CONCAT('bkf', `definition`.`id`)
AND NOT EXISTS (SELECT 1 FROM `project_deliverable_variant` `existing`);
