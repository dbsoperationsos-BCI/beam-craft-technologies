-- Project Management → Feedback: one Feedback ID per project, versioned per feedback.
--
-- Until now every feedback took its own number from the shared counter (DBS-FB-00007). Now the
-- project takes the number - DBS-FB-00001, on `sales_project.feedback_code`, minted when its first
-- feedback is given - and each of its feedbacks is a version of it, `project_feedback.feedback_version`:
--
--   DBS-FB-00001-01   the New Project Feedback, always 01 (kept for it even when a shoot's is given first)
--   DBS-FB-00001-02   the first Shoot Completion Feedback given, then -03, -04 ... in the order given
--   DBS-FB-00001-0n   the Overall Feedback, last: it opens only once every shoot's feedback is given
--
-- `project_feedback.feedback_code` keeps the whole ID, so everything that reads, searches and quotes
-- it is unchanged.
--
-- The feedback already given is renumbered the same way, by the studio's decision: projects numbered
-- in the order their first feedback was given (oldest first, by id where two share a moment), and
-- within a project the New Project Feedback 01, the rest by when they were given, the Overall Feedback
-- after them. The old ID is rewritten to the new one in the description of every task an Average or
-- Poor review was given as, which quotes it. A WhatsApp message already sent with an old ID cannot be
-- changed. The counter is set to the number of projects numbered, so the next project carries on.
--
-- Cost: a few passes over project_feedback, its issues' tasks and the projects it names - small
-- tables. Instant. No permission: read under PROJECT / Feedback like the rest of the row.

ALTER TABLE `sales_project` ADD COLUMN `feedback_code` VARCHAR(30) NULL,
    ADD UNIQUE INDEX `sales_project_feedback_code_key`(`feedback_code`);

ALTER TABLE `project_feedback` ADD COLUMN `feedback_version` INTEGER NULL;

-- The project's Feedback ID, in the order each project's first feedback was given.
UPDATE `sales_project` AS `project`
JOIN (
    SELECT `project_id`, ROW_NUMBER() OVER (ORDER BY MIN(`created_at`) ASC, `project_id` ASC) AS `sequence_number`
    FROM `project_feedback`
    GROUP BY `project_id`
) AS `ordered` ON `ordered`.`project_id` = `project`.`id`
SET `project`.`feedback_code` = CONCAT('DBS-FB-', LPAD(`ordered`.`sequence_number`, 5, '0'));

-- Each feedback's version: the New Project Feedback first, the Overall Feedback last, the rest by when
-- they were given. A project with no New Project Feedback starts at 02, keeping 01 for it.
UPDATE `project_feedback` AS `feedback`
JOIN (
    SELECT `id`,
        ROW_NUMBER() OVER (
            PARTITION BY `project_id`
            ORDER BY (`stage` = 'NEW_PROJECT') DESC, (`stage` = 'OVERALL') ASC, `created_at` ASC, `id` ASC
        ) + 1 - MAX(`stage` = 'NEW_PROJECT') OVER (PARTITION BY `project_id`) AS `version`
    FROM `project_feedback`
) AS `versioned` ON `versioned`.`id` = `feedback`.`id`
SET `feedback`.`feedback_version` = `versioned`.`version`;

-- The tasks an Average or Poor review was given as quote the feedback's ID: the old one becomes the new.
UPDATE `hrm_task` AS `task`
JOIN `project_feedback_issue` AS `issue` ON `issue`.`task_id` = `task`.`id`
JOIN `project_feedback` AS `feedback` ON `feedback`.`id` = `issue`.`feedback_id`
JOIN `sales_project` AS `project` ON `project`.`id` = `feedback`.`project_id`
SET `task`.`description` = REPLACE(
    `task`.`description`,
    `feedback`.`feedback_code`,
    CONCAT(`project`.`feedback_code`, '-', LPAD(`feedback`.`feedback_version`, 2, '0'))
);

-- Every feedback's whole ID. No new one can meet an old one: every new one ends in a version.
UPDATE `project_feedback` AS `feedback`
JOIN `sales_project` AS `project` ON `project`.`id` = `feedback`.`project_id`
SET `feedback`.`feedback_code` = CONCAT(`project`.`feedback_code`, '-', LPAD(`feedback`.`feedback_version`, 2, '0'));

ALTER TABLE `project_feedback`
    MODIFY `feedback_version` INTEGER NOT NULL,
    ADD UNIQUE INDEX `project_feedback_project_id_feedback_version_key`(`project_id`, `feedback_version`);

-- The counter now numbers projects: the next project carries on after the highest one handed out.
INSERT INTO `app_sequence` (`key`, `current_value`, `created_at`, `updated_at`)
SELECT 'PROJECT_FEEDBACK_ID', COUNT(*), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `sales_project`
WHERE `feedback_code` IS NOT NULL
ON DUPLICATE KEY UPDATE
    `current_value` = VALUES(`current_value`),
    `updated_at` = CURRENT_TIMESTAMP(3);
