-- Four changes that were developed as separate steps and ship as one migration, because none of
-- them has been released: the quotation a project converted at, employee referrals and what the
-- studio owes for them, and the Tasks module with the notification store behind it.
--
-- Merged rather than pushed as four, so the release is one thing to apply and one thing to roll
-- back. The referral settings table is written here in its final shape: it was built with a
-- third-month amount and a sixth-month amount, then changed to one amount split across both, and
-- reproducing that argument with itself on a database that never saw the first version would be
-- history for its own sake. Every other statement is exactly as it was.

-- ===========================================================================================
-- 1. Which quotation version a project converted at
-- ===========================================================================================

-- Which quotation version a project converted at.
--
-- Create Project has offered a "Select Quotation" dropdown since quotations were versioned, and it
-- sent the chosen `quotation_id` with the rest of the form - but the controller destructured it out
-- and dropped it, because there was no column to put it in. The selection's only lasting effect was
-- copying the quotation's amount into `initial_converted_value`; which version won the negotiation
-- was not recorded anywhere, so nothing could be asked about it afterwards.
--
-- Deliberately not a foreign key. A quotation can be soft-deleted while the project that converted
-- at it stands, and a constraint would either refuse that or drag the project's own record of what
-- it sold along with it. This holds `sales_quotation`.`quotation_id` - "QUT039-02", the reference a
-- person quotes over the phone - not the row's cuid.
--
-- Null for a project converted without a quotation, and for every project created before this: the
-- quotation register reads an absent match as "not finalized", never as an error.
ALTER TABLE `sales_project` ADD COLUMN `quotation_id` VARCHAR(30) NULL;

-- The register asks "which projects converted at any of these versions?" on every read.
CREATE INDEX `sales_project_quotation_id_idx` ON `sales_project`(`quotation_id`);

-- ===========================================================================================
-- 2. Employee referrals, and the two instalments each one is paid in
-- ===========================================================================================

-- What a referral is worth, as one amount handed over in two equal instalments: 6,000 is 3,000 at
-- the third month and 3,000 at the sixth.
--
-- One figure rather than two. Asking for each half separately invited them to be set to different
-- amounts by accident, and made the total something a reader had to add up. The split lives on the
-- instalment rows below, which each keep the figure they were created with - so raising this never
-- reprices a referral already promised.
CREATE TABLE `hrm_settings` (
  `id` VARCHAR(30) NOT NULL DEFAULT 'default',
  `referral_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `updated_by_user_id` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

-- The single row every settings screen reads and writes, present from the start so nothing has to
-- cope with its absence.
INSERT INTO `hrm_settings` (`id`, `referral_amount`, `created_at`, `updated_at`)
VALUES ('default', 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
-- One row per person referred; a referrer may hold many, which is why this is a table and not a
-- pair of columns on `employee`.
--
-- `referrer_employee_id` is nullable with the name kept beside it, the way `cash_entry` keeps
-- `handler_name`: deleting a referrer must not delete the record of what they were owed.
--
-- `referred_on` is the referred employee's joining date copied here, not read live. The instalment
-- dates are counted from it and a joining date stays editable long afterwards.
CREATE TABLE `employee_referral` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `referrer_employee_id` INT NULL,
  `referrer_name` VARCHAR(150) NOT NULL,
  `referred_employee_id` INT NOT NULL,
  `referred_on` DATETIME(3) NOT NULL,
  `remarks` TEXT NULL,
  `created_by_user_id` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `employee_referral_referred_employee_id_key`(`referred_employee_id`),
  INDEX `employee_referral_referrer_employee_id_idx`(`referrer_employee_id`)
);

-- Each instalment is its own row: it carries its own date, amount and state, and it is the line the
-- upcoming payslip will read. "What is due to this person this month?" is then an indexed lookup.
--
-- `amount` is stamped when the referral is created and never recalculated, so raising the studio's
-- referral amount applies to referrals made from then on and never to one already promised.
CREATE TABLE `employee_referral_payout` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `referral_id` INT NOT NULL,
  `month_offset` INT NOT NULL,
  `due_on` DATETIME(3) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'Pending',
  `paid_on` DATETIME(3) NULL,
  `paid_by_user_id` INT NULL,
  `remarks` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  -- One instalment per offset per referral, so regenerating a schedule cannot double-pay.
  UNIQUE INDEX `employee_referral_payout_referral_id_month_offset_key`(`referral_id`, `month_offset`),
  INDEX `employee_referral_payout_status_due_on_idx`(`status`, `due_on`)
);

ALTER TABLE `employee_referral`
  ADD CONSTRAINT `employee_referral_referrer_employee_id_fkey` FOREIGN KEY (`referrer_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `employee_referral_referred_employee_id_fkey` FOREIGN KEY (`referred_employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_referral_payout`
  ADD CONSTRAINT `employee_referral_payout_referral_id_fkey` FOREIGN KEY (`referral_id`) REFERENCES `employee_referral`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================================
-- 3. HRM Tasks, their activity log, and the notification store behind the top bar's bell
-- ===========================================================================================

-- HRM Tasks: one person asking another to do something, and what became of it.
--
-- Assignment is between logins rather than employee records. Anybody signed in may give a task to
-- anybody else signed in, and the studio has logins with no employee behind them (the standalone
-- Super Admin) as well as employees with no login - `user` is the only side both are on.
--
-- Both user ids are nullable with the name stored beside them, the way `cash_entry` keeps
-- `handler_name`: deleting a login must not take with it the record of who was asked to do what.
CREATE TABLE `hrm_task` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_code` VARCHAR(30) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `task_type` VARCHAR(60) NOT NULL,
  `priority` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `assigned_to_user_id` INT NULL,
  `assigned_to_name` VARCHAR(191) NOT NULL,
  `assigned_by_user_id` INT NULL,
  `assigned_by_name` VARCHAR(191) NOT NULL,
  `due_on` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `completed_by_user_id` INT NULL,
  `completed_by_name` VARCHAR(191) NULL,
  `revert_reason` TEXT NULL,
  `reverted_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `hrm_task_task_code_key`(`task_code`),
  -- The two questions My Tasks and Tasks Given ask, each narrowed by the status tabs above them.
  INDEX `hrm_task_assigned_to_user_id_status_idx`(`assigned_to_user_id`, `status`),
  INDEX `hrm_task_assigned_by_user_id_status_idx`(`assigned_by_user_id`, `status`),
  -- All Tasks, newest first.
  INDEX `hrm_task_status_created_at_idx`(`status`, `created_at`),
  INDEX `hrm_task_due_on_idx`(`due_on`)
);

-- Everything that has ever happened to a task, in the order it happened. A row per event rather
-- than a "changed by / changed at" pair on the task itself, which only ever remembers the last one.
CREATE TABLE `hrm_task_activity` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `detail` TEXT NULL,
  `user_id` INT NULL,
  `user_name` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- How the log is always read: one task's events, oldest first.
  INDEX `hrm_task_activity_task_id_created_at_idx`(`task_id`, `created_at`)
);

-- What the bell in the top bar reads. General on purpose even though tasks are the only thing
-- writing rows today: `type`, `entity_type` and `entity_id` say what a notice is about and `link`
-- says where pressing it goes, so the next module to need one writes here instead of growing a
-- second bell.
--
-- `read_at` rather than a boolean, because "when did they see it" is the question that gets asked.
CREATE TABLE `notification` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` TEXT NULL,
  `entity_type` VARCHAR(40) NULL,
  `entity_id` VARCHAR(64) NULL,
  `link` VARCHAR(300) NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- The only question the bell asks: this reader's notices, unread first, newest first.
  INDEX `notification_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`)
);

ALTER TABLE `hrm_task`
  ADD CONSTRAINT `hrm_task_assigned_to_user_id_fkey` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `hrm_task_assigned_by_user_id_fkey` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hrm_task_activity`
  ADD CONSTRAINT `hrm_task_activity_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `hrm_task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hrm_task_activity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `notification`
  ADD CONSTRAINT `notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
