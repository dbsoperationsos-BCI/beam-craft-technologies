-- Project Management → Feedback: Production Completion Feedback asks more than one review.
--
-- It is rated per area of the work - Sales, Pre Production, Production - each with its own review and
-- words (`project_feedback_area`), so the feedback's own `feedback` is null there and the column is
-- made optional. It carries the client's Referral Details (a name and a mobile, both optional), and
-- the employees the client appreciates or is not satisfied with (`project_feedback_employee`, one
-- row each, never both), picked from the people who worked on the project in those three areas.
--
-- Additive: two new tables, two nullable columns, and a NOT NULL relaxed. Nothing existing changes.
-- No permission: still PROJECT / Feedback.

ALTER TABLE `project_feedback` ADD COLUMN `referral_mobile` VARCHAR(25) NULL,
    ADD COLUMN `referral_name` VARCHAR(150) NULL,
    MODIFY `feedback` TEXT NULL;

CREATE TABLE `project_feedback_area` (
    `id` VARCHAR(191) NOT NULL,
    `feedback_id` VARCHAR(191) NOT NULL,
    `area` VARCHAR(20) NOT NULL,
    `review` VARCHAR(20) NOT NULL,
    `feedback` TEXT NOT NULL,

    UNIQUE INDEX `project_feedback_area_feedback_id_area_key`(`feedback_id`, `area`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_feedback_employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feedback_id` VARCHAR(191) NOT NULL,
    `employee_id` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,

    INDEX `project_feedback_employee_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `project_feedback_employee_feedback_id_employee_id_key`(`feedback_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_feedback_area` ADD CONSTRAINT `project_feedback_area_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `project_feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_feedback_employee` ADD CONSTRAINT `project_feedback_employee_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `project_feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_feedback_employee` ADD CONSTRAINT `project_feedback_employee_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

