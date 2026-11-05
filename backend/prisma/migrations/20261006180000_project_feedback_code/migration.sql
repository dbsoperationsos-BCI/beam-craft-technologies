-- Project Management → Feedback: the Feedback ID, DBS-FB-00001, the business id the Feedback page
-- shows and searches by. Minted from the shared counter (`app_sequence`, key PROJECT_FEEDBACK_ID)
-- when a feedback is saved.
--
-- Added in stages so the feedback already given is numbered first: the column nullable, every
-- existing row given its number in the order it was given (oldest first, by id where two share a
-- moment), then the column made required and unique, and the counter set to carry on after the
-- highest number handed out. No permission: read under PROJECT / Feedback like the rest of the row.
--
-- Cost: one pass over project_feedback, a small table. Instant.

ALTER TABLE `project_feedback` ADD COLUMN `feedback_code` VARCHAR(30) NULL;

UPDATE `project_feedback` AS `feedback`
JOIN (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC) AS `sequence_number`
    FROM `project_feedback`
) AS `ordered` ON `ordered`.`id` = `feedback`.`id`
SET `feedback`.`feedback_code` = CONCAT('DBS-FB-', LPAD(`ordered`.`sequence_number`, 5, '0'));

ALTER TABLE `project_feedback`
    MODIFY `feedback_code` VARCHAR(30) NOT NULL,
    ADD UNIQUE INDEX `project_feedback_feedback_code_key`(`feedback_code`);

-- New Feedback IDs carry on after the highest one handed out above.
INSERT INTO `app_sequence` (`key`, `current_value`, `created_at`, `updated_at`)
SELECT 'PROJECT_FEEDBACK_ID', COUNT(*), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `project_feedback`
ON DUPLICATE KEY UPDATE
    `current_value` = GREATEST(`current_value`, VALUES(`current_value`)),
    `updated_at` = CURRENT_TIMESTAMP(3);
