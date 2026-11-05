-- Settings → Templates → Interview Welcome: one WhatsApp message to each candidate a linked interview
-- Google Sheet brings in, from one HR login's WhatsApp chosen beside the wording. Off by default, so
-- nothing is sent until the studio switches it on and picks the sender.
--
-- Cost: three nullable / defaulted columns on the one-row `hrm_settings` (instant on MySQL 8), and
-- the template row, inserted only where the studio has not written one (`WHERE NOT EXISTS`).

ALTER TABLE `hrm_settings`
  ADD COLUMN `interview_welcome_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `interview_welcome_sender_user_id` INTEGER NULL,
  ADD COLUMN `interview_welcome_last_error` TEXT NULL;

CREATE INDEX `hrm_settings_interview_welcome_sender_user_id_idx` ON `hrm_settings`(`interview_welcome_sender_user_id`);

ALTER TABLE `hrm_settings` ADD CONSTRAINT `hrm_settings_interview_welcome_sender_user_id_fkey` FOREIGN KEY (`interview_welcome_sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'INTERVIEW_WELCOME', 'Interview Welcome', 'Hey thanks for your interest on this job, Please fill this questions 

1. Which position are you applying for?
2. What all softwares do you know?
3. When Can you join?
4. What is your Expected Salary?
5. What is your least Expected Salary?
6. How many years of experience do you have?
7. What is your Current Company?
8.What is your current Salary?
9. Where are you from?
10. Reason for leaving the present company?
11. Your Native place?'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'INTERVIEW_WELCOME');
