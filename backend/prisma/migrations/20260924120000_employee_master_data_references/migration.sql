-- The employee's master-data answers get references beside their text, and the three lists held
-- several of become rows.
--
-- Every list the employee form offers is a table with ids, and the employee stored only the words:
-- `designation = "Team Leader"`, `department = "Sales, Accounts"`. Nothing joined them, so a
-- department could not be indexed, counted or grouped except by its spelling, and a renamed entry
-- had to be chased through every row by text. This adds the reference beside each single-valued
-- answer and a junction table for each list somebody holds several of, backfills them by name,
-- and leaves the text exactly as it was: the form still sends it and the screens still print it
-- (DATA-SCOPE.md D36). `services/employeeReferences.js` keeps both in step on every write.
--
-- Matching is by folded name and only where the list holds exactly one row of that name: two
-- entries spelt the same stay NULL rather than guessing, the way the data-scope backfill treated
-- two employees with one name. Text naming nothing on the list keeps its text and a NULL reference.
-- Inactive rows match too - somebody filed under an entry since disabled keeps their reference.

-- ── Columns, tables, indexes and keys ──
ALTER TABLE `employee` ADD COLUMN `blood_group_id` INTEGER NULL,
    ADD COLUMN `current_work_location_id` INTEGER NULL,
    ADD COLUMN `designation_id` INTEGER NULL,
    ADD COLUMN `emergency_contact_relationship_id` INTEGER NULL,
    ADD COLUMN `gender_id` INTEGER NULL,
    ADD COLUMN `marital_status_id` INTEGER NULL,
    ADD COLUMN `work_base_location_id` INTEGER NULL,
    ADD COLUMN `work_type_id` INTEGER NULL;

CREATE TABLE `employee_department` (
    `employee_id` INTEGER NOT NULL,
    `department_id` INTEGER NOT NULL,

    INDEX `employee_department_department_id_idx`(`department_id`),
    PRIMARY KEY (`employee_id`, `department_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employee_skill` (
    `employee_id` INTEGER NOT NULL,
    `skill_id` INTEGER NOT NULL,

    INDEX `employee_skill_skill_id_idx`(`skill_id`),
    PRIMARY KEY (`employee_id`, `skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employee_language` (
    `employee_id` INTEGER NOT NULL,
    `language_id` INTEGER NOT NULL,

    INDEX `employee_language_language_id_idx`(`language_id`),
    PRIMARY KEY (`employee_id`, `language_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `employee_designation_id_idx` ON `employee`(`designation_id`);

CREATE INDEX `employee_work_type_id_idx` ON `employee`(`work_type_id`);

CREATE INDEX `employee_gender_id_idx` ON `employee`(`gender_id`);

CREATE INDEX `employee_blood_group_id_idx` ON `employee`(`blood_group_id`);

CREATE INDEX `employee_marital_status_id_idx` ON `employee`(`marital_status_id`);

CREATE INDEX `employee_emergency_contact_relationship_id_idx` ON `employee`(`emergency_contact_relationship_id`);

CREATE INDEX `employee_work_base_location_id_idx` ON `employee`(`work_base_location_id`);

CREATE INDEX `employee_current_work_location_id_idx` ON `employee`(`current_work_location_id`);

ALTER TABLE `employee` ADD CONSTRAINT `employee_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_work_type_id_fkey` FOREIGN KEY (`work_type_id`) REFERENCES `work_type`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_gender_id_fkey` FOREIGN KEY (`gender_id`) REFERENCES `gender`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_blood_group_id_fkey` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_marital_status_id_fkey` FOREIGN KEY (`marital_status_id`) REFERENCES `marital_status`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_emergency_contact_relationship_id_fkey` FOREIGN KEY (`emergency_contact_relationship_id`) REFERENCES `emergency_contact_relationship`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_work_base_location_id_fkey` FOREIGN KEY (`work_base_location_id`) REFERENCES `work_location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD CONSTRAINT `employee_current_work_location_id_fkey` FOREIGN KEY (`current_work_location_id`) REFERENCES `work_location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee_department` ADD CONSTRAINT `employee_department_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_department` ADD CONSTRAINT `employee_department_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_skill` ADD CONSTRAINT `employee_skill_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_skill` ADD CONSTRAINT `employee_skill_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_language` ADD CONSTRAINT `employee_language_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_language` ADD CONSTRAINT `employee_language_language_id_fkey` FOREIGN KEY (`language_id`) REFERENCES `language`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: one answer, one reference ──
UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `designation` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`designation`))
   SET `e`.`designation_id` = `m`.`id`
 WHERE `e`.`designation` IS NOT NULL AND TRIM(`e`.`designation`) <> '' AND `e`.`designation_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `work_type` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`work_type`))
   SET `e`.`work_type_id` = `m`.`id`
 WHERE `e`.`work_type` IS NOT NULL AND TRIM(`e`.`work_type`) <> '' AND `e`.`work_type_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `gender` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`gender`))
   SET `e`.`gender_id` = `m`.`id`
 WHERE `e`.`gender` IS NOT NULL AND TRIM(`e`.`gender`) <> '' AND `e`.`gender_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `blood_group` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`blood_group`))
   SET `e`.`blood_group_id` = `m`.`id`
 WHERE `e`.`blood_group` IS NOT NULL AND TRIM(`e`.`blood_group`) <> '' AND `e`.`blood_group_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `marital_status` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`marital_status`))
   SET `e`.`marital_status_id` = `m`.`id`
 WHERE `e`.`marital_status` IS NOT NULL AND TRIM(`e`.`marital_status`) <> '' AND `e`.`marital_status_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `emergency_contact_relationship` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`emergency_contact_relationship`))
   SET `e`.`emergency_contact_relationship_id` = `m`.`id`
 WHERE `e`.`emergency_contact_relationship` IS NOT NULL AND TRIM(`e`.`emergency_contact_relationship`) <> '' AND `e`.`emergency_contact_relationship_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `work_location` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`work_base_location`))
   SET `e`.`work_base_location_id` = `m`.`id`
 WHERE `e`.`work_base_location` IS NOT NULL AND TRIM(`e`.`work_base_location`) <> '' AND `e`.`work_base_location_id` IS NULL;

UPDATE `employee` AS `e`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `work_location` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(TRIM(`e`.`current_work_location`))
   SET `e`.`current_work_location_id` = `m`.`id`
 WHERE `e`.`current_work_location` IS NOT NULL AND TRIM(`e`.`current_work_location`) <> '' AND `e`.`current_work_location_id` IS NULL;

-- ── Backfill: several answers, one row each ──
INSERT IGNORE INTO `employee_department` (`employee_id`, `department_id`)
WITH RECURSIVE `parts` AS (
  SELECT `id` AS `employee_id`, TRIM(SUBSTRING_INDEX(`department`, ',', 1)) AS `part`,
         IF(LOCATE(',', `department`) = 0, '', SUBSTRING(`department`, LOCATE(',', `department`) + 1)) AS `rest`
    FROM `employee` WHERE `department` IS NOT NULL AND TRIM(`department`) <> ''
  UNION ALL
  SELECT `employee_id`, TRIM(SUBSTRING_INDEX(`rest`, ',', 1)),
         IF(LOCATE(',', `rest`) = 0, '', SUBSTRING(`rest`, LOCATE(',', `rest`) + 1))
    FROM `parts` WHERE `rest` <> ''
)
SELECT `p`.`employee_id`, `m`.`id`
  FROM `parts` AS `p`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `department` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(`p`.`part`)
 WHERE `p`.`part` <> '';

INSERT IGNORE INTO `employee_skill` (`employee_id`, `skill_id`)
WITH RECURSIVE `parts` AS (
  SELECT `id` AS `employee_id`, TRIM(SUBSTRING_INDEX(`skills`, ',', 1)) AS `part`,
         IF(LOCATE(',', `skills`) = 0, '', SUBSTRING(`skills`, LOCATE(',', `skills`) + 1)) AS `rest`
    FROM `employee` WHERE `skills` IS NOT NULL AND TRIM(`skills`) <> ''
  UNION ALL
  SELECT `employee_id`, TRIM(SUBSTRING_INDEX(`rest`, ',', 1)),
         IF(LOCATE(',', `rest`) = 0, '', SUBSTRING(`rest`, LOCATE(',', `rest`) + 1))
    FROM `parts` WHERE `rest` <> ''
)
SELECT `p`.`employee_id`, `m`.`id`
  FROM `parts` AS `p`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `skill` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(`p`.`part`)
 WHERE `p`.`part` <> '';

INSERT IGNORE INTO `employee_language` (`employee_id`, `language_id`)
WITH RECURSIVE `parts` AS (
  SELECT `id` AS `employee_id`, TRIM(SUBSTRING_INDEX(`languages_known`, ',', 1)) AS `part`,
         IF(LOCATE(',', `languages_known`) = 0, '', SUBSTRING(`languages_known`, LOCATE(',', `languages_known`) + 1)) AS `rest`
    FROM `employee` WHERE `languages_known` IS NOT NULL AND TRIM(`languages_known`) <> ''
  UNION ALL
  SELECT `employee_id`, TRIM(SUBSTRING_INDEX(`rest`, ',', 1)),
         IF(LOCATE(',', `rest`) = 0, '', SUBSTRING(`rest`, LOCATE(',', `rest`) + 1))
    FROM `parts` WHERE `rest` <> ''
)
SELECT `p`.`employee_id`, `m`.`id`
  FROM `parts` AS `p`
  JOIN (SELECT LOWER(TRIM(`name`)) AS `k`, MIN(`id`) AS `id`, COUNT(*) AS `n` FROM `language` GROUP BY `k` HAVING `n` = 1) AS `m`
    ON `m`.`k` = LOWER(`p`.`part`)
 WHERE `p`.`part` <> '';
