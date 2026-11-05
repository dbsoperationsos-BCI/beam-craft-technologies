-- The offboarding invite: the form HR sends an employee who is leaving, and what they fill in.
--
-- The mirror of `employee_onboarding_invite` at the other end of the employment. HR raises it
-- against an employee, says how many days of notice is to be served, and the employee opens a
-- tokenised link and answers from when they are serving it; approving the submission writes the
-- `employee_separation`, which is what puts them on Serving Notice.
--
-- A new table only - nothing existing is touched, so there is nothing to fail on production data.

CREATE TABLE `employee_offboarding_invite` (
    `id` VARCHAR(191) NOT NULL,
    `offboarding_id` VARCHAR(30) NULL,
    `employee_id` INTEGER NOT NULL,
    `notice_period_days` INTEGER NOT NULL,
    `hr_note` TEXT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_preview` VARCHAR(32) NULL,
    `token` VARCHAR(64) NULL,
    `short_code` VARCHAR(8) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Sent',
    `expires_at` DATETIME(3) NOT NULL,
    `verify_failures` INTEGER NOT NULL DEFAULT 0,
    `verify_locked_until` DATETIME(3) NULL,
    `verified_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `notice_start_date` DATE NULL,
    `expected_last_working_date` DATE NULL,
    `reason` VARCHAR(150) NULL,
    `detailed_reason` TEXT NULL,
    `letter_key` VARCHAR(500) NULL,
    `letter_url` TEXT NULL,
    `letter_file_name` VARCHAR(255) NULL,
    `reviewed_by_user_id` INTEGER NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_remark` TEXT NULL,
    `separation_id` INTEGER NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_offboarding_invite_offboarding_id_key`(`offboarding_id`),
    UNIQUE INDEX `employee_offboarding_invite_token_hash_key`(`token_hash`),
    UNIQUE INDEX `employee_offboarding_invite_short_code_key`(`short_code`),
    UNIQUE INDEX `employee_offboarding_invite_separation_id_key`(`separation_id`),
    INDEX `employee_offboarding_invite_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `employee_offboarding_invite_employee_id_idx`(`employee_id`),
    INDEX `employee_offboarding_invite_created_at_idx`(`created_at`),
    INDEX `employee_offboarding_invite_reviewed_by_user_id_idx`(`reviewed_by_user_id`),
    INDEX `employee_offboarding_invite_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_offboarding_invite` ADD CONSTRAINT `employee_offboarding_invite_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_offboarding_invite` ADD CONSTRAINT `employee_offboarding_invite_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `employee_offboarding_invite` ADD CONSTRAINT `employee_offboarding_invite_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `employee_offboarding_invite` ADD CONSTRAINT `employee_offboarding_invite_separation_id_fkey` FOREIGN KEY (`separation_id`) REFERENCES `employee_separation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;