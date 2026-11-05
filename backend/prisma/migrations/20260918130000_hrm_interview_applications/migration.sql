-- The Interview screen becomes an application pipeline: the stages are renamed to say what the
-- studio is waiting on, a candidate carries what an application form asks, and a candidate can be
-- sent the form itself.
--
-- 1. **Two stages renamed.** `New` reads as "Yet to Connect" - nobody has spoken to the person yet -
--    and `Screening` as "Form Submission Pending" - the application form has gone out and has not
--    come back. Statuses are text on the row, so the rows written under the old names are moved,
--    and a third stage, "Form Submitted", sits after the two for a form that has
--    come back and is waiting to be read. Nothing is written for it here: it is reached by a
--    candidate submitting, and no row holds it yet.
--
-- 2. **The application's own columns.** What an application form in a corporate or a studio asks
--    beyond the contact card: the kind of engagement, who the person is, what they know and where
--    they have worked. All nullable, all text, like the columns beside them.
--
-- 3. **The application invite.** The link a candidate fills the form in from - the Interview
--    module's counterpart of `employee_onboarding_invite`, with the same hashed token, short code,
--    expiry and gate. `candidate_id` is the register row the form writes into.
--
-- No permission changes: everything here answers to `HRM / Interview`, which already exists. The
-- public form answers by token, the way the onboarding form does.
--
-- Cost: an ALTER on an empty-or-small table, one new table, and two UPDATEs by status. Instant.

-- ============================================================================================
-- 1. The renamed stages
-- ============================================================================================
UPDATE `hrm_interview_candidate` SET `status` = 'Yet to Connect' WHERE `status` = 'New';
UPDATE `hrm_interview_candidate` SET `status` = 'Form Submission Pending' WHERE `status` = 'Screening';

-- ============================================================================================
-- 2. What an application asks
-- ============================================================================================
ALTER TABLE `hrm_interview_candidate` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `available_from` VARCHAR(40) NULL,
    ADD COLUMN `current_designation` VARCHAR(150) NULL,
    ADD COLUMN `date_of_birth` VARCHAR(40) NULL,
    ADD COLUMN `education_entries` LONGTEXT NULL,
    ADD COLUMN `employment_type` VARCHAR(40) NULL,
    ADD COLUMN `experience_entries` LONGTEXT NULL,
    ADD COLUMN `gender` VARCHAR(30) NULL,
    ADD COLUMN `highest_qualification` VARCHAR(191) NULL,
    ADD COLUMN `languages_known` TEXT NULL,
    ADD COLUMN `portfolio_url` VARCHAR(1000) NULL,
    ADD COLUMN `skills` TEXT NULL,
    MODIFY `status` VARCHAR(40) NOT NULL DEFAULT 'Yet to Connect';


-- ============================================================================================
-- 3. The application invite
-- ============================================================================================
CREATE TABLE `hrm_interview_application_invite` (
    `id` VARCHAR(191) NOT NULL,
    `candidate_id` VARCHAR(191) NULL,
    `candidate_name` VARCHAR(150) NOT NULL,
    `candidate_email` VARCHAR(191) NOT NULL,
    `candidate_phone` VARCHAR(30) NOT NULL,
    `position` VARCHAR(150) NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_preview` VARCHAR(32) NULL,
    `token` VARCHAR(64) NULL,
    `short_code` VARCHAR(8) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Created',
    `expires_at` DATETIME(3) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hrm_interview_application_invite_token_hash_key`(`token_hash`),
    UNIQUE INDEX `hrm_interview_application_invite_short_code_key`(`short_code`),
    INDEX `hrm_interview_application_invite_candidate_id_idx`(`candidate_id`),
    INDEX `hrm_interview_application_invite_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `hrm_interview_application_invite_candidate_email_idx`(`candidate_email`),
    INDEX `hrm_interview_application_invite_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
