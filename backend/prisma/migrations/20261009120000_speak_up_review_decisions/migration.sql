-- Speak-up Review decides each speak-up: Approve, Approve & Assign (an HRM task) or Reject.
-- Every speak-up already here starts as PENDING. Additive only: no row is rewritten.

-- AlterTable
ALTER TABLE `speak_up` ADD COLUMN `review_remark` TEXT NULL,
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `reviewed_by_user_id` INTEGER NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `task_id` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `speak_up_task_id_key` ON `speak_up`(`task_id`);

-- CreateIndex
CREATE INDEX `speak_up_status_idx` ON `speak_up`(`status`);

-- CreateIndex
CREATE INDEX `speak_up_reviewed_by_user_id_idx` ON `speak_up`(`reviewed_by_user_id`);

-- AddForeignKey
ALTER TABLE `speak_up` ADD CONSTRAINT `speak_up_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `speak_up` ADD CONSTRAINT `speak_up_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `hrm_task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

