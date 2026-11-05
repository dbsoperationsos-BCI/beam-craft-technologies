-- Project Management → Feedback: a project's feedback in stages.
--
-- A project is asked for its New Project Feedback as soon as it is created, and again for its
-- Production Completion Feedback once Production has completed its shoots (Project Completed
-- Feedback is still to come). So a feedback says which stage it is (`stage`), and the one-per-
-- project key becomes one per project per stage.
--
-- Every feedback given so far is a New Project Feedback, which is what the column's default writes
-- into the existing rows. The new key is added before the old one is dropped, so `project_id` - the
-- leading column of both - keeps an index for its foreign key throughout. No permission: still
-- PROJECT / Feedback.
--
-- Cost: one column with a constant default and one index swap on a small table. Instant.

ALTER TABLE `project_feedback` ADD COLUMN `stage` VARCHAR(40) NOT NULL DEFAULT 'NEW_PROJECT';

CREATE UNIQUE INDEX `project_feedback_project_id_stage_key` ON `project_feedback`(`project_id`, `stage`);

DROP INDEX `project_feedback_project_id_key` ON `project_feedback`;
