-- Accounts Manager no longer follows a scheduled payment up.
--
-- A payment could be set to Follow-up with a date and remarks, which Due and Overdue then went by.
-- That status, its tab and its choice are gone; a payment is Due or Overdue by its due date alone, and
-- Active otherwise. The four columns that held it are dropped. Unreleased, so no live data is lost.
--
-- Cost: one foreign key, one index and four nullable columns dropped from project_payment_schedule.

-- DropForeignKey
ALTER TABLE `project_payment_schedule` DROP FOREIGN KEY `project_payment_schedule_followup_by_user_id_fkey`;

-- DropIndex
DROP INDEX `project_payment_schedule_followup_by_user_id_idx` ON `project_payment_schedule`;

-- AlterTable
ALTER TABLE `project_payment_schedule` DROP COLUMN `followup_at`,
    DROP COLUMN `followup_by_user_id`,
    DROP COLUMN `followup_date`,
    DROP COLUMN `followup_remarks`;
