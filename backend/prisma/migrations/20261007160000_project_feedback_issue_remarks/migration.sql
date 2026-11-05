-- Project Management → Feedback: the remark given when a feedback under Issues is moved to Issues
-- sorted or Rejected (required for Rejected, optional for Issues sorted), and who moved it and when.
--
-- All three are nullable with no default: the feedback already sorted or rejected has no remark,
-- and reads as none. No permission: moving it on is already PROJECT / Feedback at Read & Write.
--
-- Cost: three nullable columns, one index and one key on a small table. Instant.
ALTER TABLE `project_feedback`
    ADD COLUMN `issue_remarks` TEXT NULL,
    ADD COLUMN `issue_resolved_by_user_id` INTEGER NULL,
    ADD COLUMN `issue_resolved_at` DATETIME(3) NULL;

CREATE INDEX `project_feedback_issue_resolved_by_user_id_idx` ON `project_feedback`(`issue_resolved_by_user_id`);

ALTER TABLE `project_feedback` ADD CONSTRAINT `project_feedback_issue_resolved_by_user_id_fkey` FOREIGN KEY (`issue_resolved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
