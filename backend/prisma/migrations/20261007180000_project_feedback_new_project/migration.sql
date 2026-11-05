-- Project Management → Feedback: New Project Feedback.
--
-- Feedback is now asked for on a project as soon as it is created in Bookings & Converted - one per
-- project, on the project as a whole - instead of on each shoot Production completes. So a feedback
-- names its project (`project_id`, one per project, held by the unique key) and no shoot.
--
-- The feedback given on shoots before this is removed, by the studio's decision: every existing row
-- is one (`shoot_id` was required), so every existing row goes. The Feedback ID counter
-- (`app_sequence` PROJECT_FEEDBACK_ID) is left as it is, so no Feedback ID is ever given twice. No
-- permission: giving feedback is still PROJECT / Feedback.
--
-- Cost: one delete of a small table, then its columns, index and keys. Instant.

DELETE FROM `project_feedback` WHERE `shoot_id` IS NOT NULL;

ALTER TABLE `project_feedback` DROP FOREIGN KEY `project_feedback_shoot_id_fkey`;

DROP INDEX `project_feedback_shoot_id_idx` ON `project_feedback`;

ALTER TABLE `project_feedback`
    DROP COLUMN `shoot_id`,
    ADD COLUMN `project_id` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `project_feedback_project_id_key` ON `project_feedback`(`project_id`);

ALTER TABLE `project_feedback` ADD CONSTRAINT `project_feedback_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
