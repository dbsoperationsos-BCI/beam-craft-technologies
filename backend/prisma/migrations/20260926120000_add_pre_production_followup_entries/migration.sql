-- A project's follow-ups become a list rather than one row.
--
-- `project_pre_production_followup` held a single last date and a single next date per project, so
-- a coordinator could owe the client only one call at a time and had to type the last date in by
-- hand. Each follow-up is now its own row: pending until it is marked done, the earliest pending
-- date being the project's next follow-up and the latest `done_at` its last. The old table is left
-- as it is, with nothing reading it, so its historic values survive.
CREATE TABLE `project_pre_production_followup_entry` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `followup_date` DATETIME(3) NOT NULL,
    `remarks` TEXT NULL,
    `done_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `done_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_pre_production_followup_entry_project_id_done_at_idx`(`project_id`, `done_at`),
    INDEX `project_pre_production_followup_entry_followup_date_idx`(`followup_date`),
    INDEX `project_pre_production_followup_entry_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `project_pre_production_followup_entry_done_by_user_id_idx`(`done_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_pre_production_followup_entry` ADD CONSTRAINT `project_pre_production_followup_entry_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_pre_production_followup_entry` ADD CONSTRAINT `project_pre_production_followup_entry_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_pre_production_followup_entry` ADD CONSTRAINT `project_pre_production_followup_entry_done_by_user_id_fkey`
  FOREIGN KEY (`done_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry the old record across. A next date becomes a pending follow-up, carrying the remarks; a
-- last date becomes one already done on that day, carrying the remarks only when there was no next
-- date to hold them. `UUID()` only has to be unique, and never collides with the application's
-- cuids. The new table starts empty, so nothing here can run twice into itself.
INSERT INTO `project_pre_production_followup_entry`
  (`id`, `project_id`, `followup_date`, `remarks`, `created_by_user_id`, `created_at`, `updated_at`)
SELECT UUID(), f.`project_id`, f.`next_followup_date`, NULLIF(TRIM(f.`remarks`), ''), f.`updated_by_user_id`, f.`created_at`, CURRENT_TIMESTAMP(3)
FROM `project_pre_production_followup` f
WHERE f.`next_followup_date` IS NOT NULL;

INSERT INTO `project_pre_production_followup_entry`
  (`id`, `project_id`, `followup_date`, `remarks`, `done_at`, `created_by_user_id`, `done_by_user_id`, `created_at`, `updated_at`)
SELECT UUID(), f.`project_id`, f.`last_followup_date`,
  CASE WHEN f.`next_followup_date` IS NULL THEN NULLIF(TRIM(f.`remarks`), '') ELSE NULL END,
  f.`last_followup_date`, f.`updated_by_user_id`, f.`updated_by_user_id`, f.`created_at`, CURRENT_TIMESTAMP(3)
FROM `project_pre_production_followup` f
WHERE f.`last_followup_date` IS NOT NULL;
