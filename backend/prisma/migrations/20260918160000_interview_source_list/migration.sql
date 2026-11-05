-- Where an application came from becomes a list the studio maintains, under
-- Settings -> Fields -> Interview -> Sources.
--
-- It was an array in `hrm/interview/candidates.js` and a second copy of the same array in
-- `frontend/src/constants/interviewConfig.js`, which is two faults rather than one: a studio that
-- started advertising somewhere new could not say so, and the two copies could disagree about what
-- the picker offered. One table, read by the Add Application dialog, the record panel and Bulk
-- Entry through the module's own options endpoint.
--
-- Seeded with what the two arrays held **plus Meta Ads and Google Ads**, which is what the list was
-- missing and the reason it stopped being an array. `Meta Ads` is spelled the way `Google Ads`
-- already is in `referral_source`, so the studio's two ad sources read alike; either can be renamed
-- in Field Settings.
--
-- Two of the old values are deliberately not rows: "Application Form" and "Google sheet
-- integration" are what the public form and the sheet importer stamp on a candidate and compare
-- against, so they stay named in `candidates.js` - a studio renaming a row must not change what an
-- importer writes, and nobody taking down an application by hand would reach for either.
--
-- `prisma/seeds/interview-sources.seed.js` holds the same rows for a developer's machine and is the
-- file to keep this in step with; this migration is what reaches production, where the seed cannot
-- be run (CLAUDE.md). The seed fills only what is missing, and so does this: `WHERE NOT EXISTS`
-- against the whole table, so a re-run writes nothing and a studio's own edits are never talked
-- back.
--
-- Cost: one table and eleven rows. Instant.

CREATE TABLE `interview_source` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `interview_source_code_key`(`code`),
    INDEX `interview_source_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The order is the answer's own: the boards and ad platforms the studio spends on first, the ways
-- somebody arrives without being advertised to next, and Other last wherever the list ends up.
INSERT INTO `interview_source` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'NAUKRI' AS `code`, 'Naukri' AS `name`, 10 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'LINKEDIN', 'LinkedIn', 20, NOW(3)
  UNION ALL SELECT 'INDEED', 'Indeed', 30, NOW(3)
  UNION ALL SELECT 'META_ADS', 'Meta Ads', 40, NOW(3)
  UNION ALL SELECT 'GOOGLE_ADS', 'Google Ads', 50, NOW(3)
  UNION ALL SELECT 'SOCIAL_MEDIA', 'Social Media', 60, NOW(3)
  UNION ALL SELECT 'WEBSITE', 'Website', 70, NOW(3)
  UNION ALL SELECT 'CAMPUS', 'Campus', 80, NOW(3)
  UNION ALL SELECT 'REFERRAL', 'Referral', 90, NOW(3)
  UNION ALL SELECT 'WALK_IN', 'Walk-in', 100, NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', 110, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `interview_source` `existing`);
