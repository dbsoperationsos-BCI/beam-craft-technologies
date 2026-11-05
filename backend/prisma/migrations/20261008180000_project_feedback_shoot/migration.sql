-- Project Management → Customer Issues and Feedback: Shoot Completion Feedback.
--
-- Every shoot Production completes waits on Yet to be done for a feedback of its own, so a feedback
-- can name its shoot (`shoot_id`, null for a project's New Project Feedback and for the stages asked
-- for before). One per project per stage per shoot: the unique key widens from (project, stage) to
-- (project, stage, shoot). A key does not compare a missing shoot, so the one New Project Feedback per
-- project is held by the save, which locks the project row first.
--
-- The new key is created before the old one is dropped: it starts with `project_id`, so the
-- project's foreign key always has an index to stand on. No row is rewritten - every existing one
-- keeps a null shoot. No permission: giving feedback is still PROJECT / Feedback.
--
-- Cost: one nullable column, two indexes and a key on a small table. Instant.
ALTER TABLE `project_feedback` ADD COLUMN `shoot_id` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `project_feedback_project_id_stage_shoot_id_key` ON `project_feedback`(`project_id`, `stage`, `shoot_id`);

DROP INDEX `project_feedback_project_id_stage_key` ON `project_feedback`;

CREATE INDEX `project_feedback_shoot_id_idx` ON `project_feedback`(`shoot_id`);

ALTER TABLE `project_feedback` ADD CONSTRAINT `project_feedback_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
