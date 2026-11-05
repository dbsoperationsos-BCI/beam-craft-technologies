-- Project Management → Feedback: the table "Add Feedback" writes to.
--
-- One row is one person's review of one shoot - a rating (Excellent, Good, Average, Poor) and what
-- they wrote. The shoot is its key, never the `SH-…` code shown on screen, so feedback follows a
-- shoot that is re-coded and goes with a shoot that is removed. The project is reached through the
-- shoot, not copied here, which is why there is no project or branch column: feedback is seen exactly
-- when its project is (`projectAccessWhere`), the way a client gift or an attachment is.
--
-- Who wrote it is kept as a key to `user`, and survives that login being removed as "nobody".
--
-- Cost: a new, empty table. Nothing existing is read or rewritten.

-- CreateTable
CREATE TABLE `project_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `review` VARCHAR(20) NOT NULL,
    `feedback` TEXT NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_feedback_shoot_id_idx`(`shoot_id`),
    INDEX `project_feedback_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `project_feedback_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_feedback` ADD CONSTRAINT `project_feedback_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_feedback` ADD CONSTRAINT `project_feedback_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
