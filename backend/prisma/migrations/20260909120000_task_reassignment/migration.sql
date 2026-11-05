-- Reassigning a task, in place of rolling it back.
--
-- Rolling back closed a task and handed it to nobody: the person who set it got an explanation and
-- the work stopped. Reassigning is the same act with a destination — the receiver says why they
-- cannot do it and names who can — so the work carries on instead of landing back where it started.
--
-- ── The columns are renamed, not replaced ──
--
-- `revert_reason` held "why this left the person holding it", which is exactly what a reassignment
-- reason is. Adding new columns beside it would leave two places holding one fact and every reader
-- deciding which to show, and would strand the reasons already written on old rolled-back tasks.
--
-- ── The status is rewritten, and why that is honest ──
--
-- `REVERTED` becomes `REASSIGNED`. What actually happened to those tasks is not being edited: every
-- one of them keeps its activity log, which says "Rolled back by X. Reason: …" in the words it was
-- written in. The status column is the *tab a task is filed under*, and there is no Reverted tab any
-- more — left as it was, those tasks would be filed under a heading no screen offers and would
-- simply vanish from the register.
--
-- REASSIGNED is an **open** status where REVERTED was closed: the task is waiting on somebody new,
-- so it has to be startable. Only COMPLETED and CANCELLED close a task now.
ALTER TABLE `hrm_task` CHANGE COLUMN `revert_reason` `reassign_reason` TEXT NULL;
ALTER TABLE `hrm_task` CHANGE COLUMN `reverted_at` `reassigned_at` DATETIME(3) NULL;
ALTER TABLE `hrm_task` ADD COLUMN `reassigned_from_user_id` INT NULL;
ALTER TABLE `hrm_task` ADD COLUMN `reassigned_from_name` VARCHAR(191) NULL;
CREATE INDEX `hrm_task_reassigned_from_user_id_idx` ON `hrm_task`(`reassigned_from_user_id`);
UPDATE `hrm_task` SET `status` = 'REASSIGNED' WHERE `status` = 'REVERTED';

-- Everybody who has held a task.
--
-- A table rather than a list on the task, because My Tasks *queries* it — "which tasks have I ever
-- held" — and a JSON array cannot be indexed for that. The current holder is a row here too, so the
-- question stays one uniform lookup.
--
-- It never shrinks: a task passed from B to C keeps B, which is the point. B is owed sight of what
-- became of the work they were asked to do.
CREATE TABLE `hrm_task_holder` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `user_id` INT NULL,
  `name` VARCHAR(191) NOT NULL,
  `held_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `hrm_task_holder_task_id_user_id_key`(`task_id`, `user_id`),
  INDEX `hrm_task_holder_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hrm_task_holder` ADD CONSTRAINT `hrm_task_holder_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `hrm_task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hrm_task_holder` ADD CONSTRAINT `hrm_task_holder_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Every task that already exists has had exactly one holder, so far as anything recorded knows.
-- Without this backfill My Tasks would empty itself the moment it started reading this table.
INSERT INTO `hrm_task_holder` (`task_id`, `user_id`, `name`, `held_at`)
SELECT `id`, `assigned_to_user_id`, `assigned_to_name`, `created_at`
FROM `hrm_task`
WHERE `assigned_to_user_id` IS NOT NULL;
