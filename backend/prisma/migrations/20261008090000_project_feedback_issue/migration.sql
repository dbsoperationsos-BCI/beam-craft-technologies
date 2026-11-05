-- Project Management → Feedback: an Average or Poor review is given to somebody to answer.
--
-- Every review a feedback form asks for - New Project's one, Production Completion's Sales, Pre
-- Production and Production, Project Completed's Post Production and Overall Experience - that comes
-- back Average or Poor is assigned to a person, and becomes an HRM task for them (`hrm_task`). They
-- answer it Issues sorted or Rejected, with a remark; once every issue of a feedback is answered, the
-- feedback leaves Issues - for Rejected if any was rejected, else Issues sorted. One row per review
-- (`project_feedback_issue`), keyed to its task, which is never deleted (`ON DELETE RESTRICT`).
--
-- Additive: one new table. Feedback given before has no rows here and keeps the Feedback page's own
-- Issues sorted / Rejected menu. No permission: giving feedback is PROJECT / Feedback, answering the
-- task is the assignee's, under HRM / Task Management.

CREATE TABLE `project_feedback_issue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feedback_id` VARCHAR(191) NOT NULL,
    `review_key` VARCHAR(30) NOT NULL,
    `review` VARCHAR(20) NOT NULL,
    `task_id` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `remarks` TEXT NULL,
    `answered_by_user_id` INTEGER NULL,
    `answered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_feedback_issue_task_id_key`(`task_id`),
    INDEX `project_feedback_issue_answered_by_user_id_idx`(`answered_by_user_id`),
    UNIQUE INDEX `project_feedback_issue_feedback_id_review_key_key`(`feedback_id`, `review_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_feedback_issue` ADD CONSTRAINT `project_feedback_issue_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `project_feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_feedback_issue` ADD CONSTRAINT `project_feedback_issue_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `hrm_task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `project_feedback_issue` ADD CONSTRAINT `project_feedback_issue_answered_by_user_id_fkey` FOREIGN KEY (`answered_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

