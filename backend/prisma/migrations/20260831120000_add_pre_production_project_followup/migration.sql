-- Chasing the client is done once for a project, not once per shoot.
--
-- A coordinator rings the couple about the wedding, not about the Haldi and then again about the
-- Reception, so the follow-up dates move from `project_pre_production` (one row per shoot) to their
-- own project-level record shown under the shoot cards.
CREATE TABLE `project_pre_production_followup` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `last_followup_date` DATETIME(3) NULL,
    `next_followup_date` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_pre_production_followup_project_id_key`(`project_id`),
    INDEX `project_pre_production_followup_next_followup_date_idx`(`next_followup_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_pre_production_followup` ADD CONSTRAINT `project_pre_production_followup_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_pre_production_followup` ADD CONSTRAINT `project_pre_production_followup_updated_by_user_id_fkey`
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry across whatever was already recorded per shoot, so no chasing is lost. The most recent
-- contact is the project's last follow-up and the soonest date owed is its next; the remarks are
-- taken from the shoot that holds the latest contact. Projects nobody had chased get no row.
INSERT IGNORE INTO `project_pre_production_followup`
  (`id`, `project_id`, `last_followup_date`, `next_followup_date`, `remarks`, `created_at`, `updated_at`)
SELECT
  UUID(),
  p.`project_id`,
  MAX(p.`last_followup_date`),
  MIN(p.`next_followup_date`),
  SUBSTRING_INDEX(GROUP_CONCAT(p.`followup_remarks` ORDER BY p.`last_followup_date` DESC SEPARATOR '\n'), '\n', 1),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `project_pre_production` p
WHERE p.`last_followup_date` IS NOT NULL
   OR p.`next_followup_date` IS NOT NULL
   OR (p.`followup_remarks` IS NOT NULL AND TRIM(p.`followup_remarks`) <> '')
GROUP BY p.`project_id`;
