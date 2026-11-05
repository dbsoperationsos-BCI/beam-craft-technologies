-- A shoot's concepts become a list rather than one reference and one remark.
--
-- A shoot can be agreed several concepts with the client, each with its own reference and notes, so
-- the coordinator adds them one by one — the way an employee's qualifications are entered. The old
-- `concept_reference` / `concept_remarks` columns on `project_pre_production` are left as they are,
-- with nothing reading them, so their historic values survive.
CREATE TABLE `project_pre_production_concept` (
    `id` VARCHAR(191) NOT NULL,
    `pre_production_id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(2048) NULL,
    `remarks` TEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_pre_production_concept_pre_production_id_position_idx`(`pre_production_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_pre_production_concept` ADD CONSTRAINT `project_pre_production_concept_pre_production_id_fkey`
  FOREIGN KEY (`pre_production_id`) REFERENCES `project_pre_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry each shoot's single concept across as the first of its list. Blank text becomes NULL, and a
-- shoot with neither a reference nor remarks gets no row. The new table starts empty, so nothing
-- here can run into itself.
INSERT INTO `project_pre_production_concept`
  (`id`, `pre_production_id`, `reference`, `remarks`, `position`, `created_at`, `updated_at`)
SELECT UUID(), p.`id`, NULLIF(TRIM(p.`concept_reference`), ''), NULLIF(TRIM(p.`concept_remarks`), ''), 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `project_pre_production` p
WHERE TRIM(COALESCE(p.`concept_reference`, '')) <> ''
   OR TRIM(COALESCE(p.`concept_remarks`, '')) <> '';
