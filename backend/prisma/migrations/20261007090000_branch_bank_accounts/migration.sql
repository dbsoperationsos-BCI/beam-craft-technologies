-- A branch's bank accounts become rows of their own, because a branch is commonly paid into more
-- than one and the four columns on `branch` could hold exactly one.
--
-- Replayable and in this order on purpose: the table is created, every account the register already
-- holds is copied into it, and only then are the old columns dropped. Rehearse on a copy of the
-- database before production - the last statement is not reversible.

CREATE TABLE IF NOT EXISTS `branch_bank_account` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `branch_id` INTEGER NOT NULL,
  `account_holder_name` VARCHAR(150) NOT NULL,
  `bank_name` VARCHAR(120) NOT NULL,
  `account_number` VARCHAR(18) NOT NULL,
  `ifsc_code` VARCHAR(11) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `branch_bank_account_branch_id_position_idx`(`branch_id`, `position`),
  INDEX `branch_bank_account_account_number_idx`(`account_number`),
  -- One branch may not hold the same account twice: that is a pasted row, not a second account.
  -- Safe to add here where a global unique is not - a branch held exactly one account before this
  -- table, so no branch can already have a repeat, while the same number on *two* branches may
  -- predate the check that refuses it and would fail the migration.
  UNIQUE INDEX `branch_bank_account_branch_id_account_number_key`(`branch_id`, `account_number`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The account number is deliberately not unique here: the register has always refused one another
-- branch holds, but that check is the application's, and rows written before it exists may repeat.
-- A unique index would be a migration that fails on production data.

ALTER TABLE `branch_bank_account`
  ADD CONSTRAINT `branch_bank_account_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Each branch's single account becomes the first row of its list. Only where there is an account
-- number: that is what made a branch payable, and a holder's name on its own was a label over
-- nothing. The three fields beside it are NOT NULL here, so a branch that held an account number
-- and nothing else arrives with blanks rather than being left behind - the register will ask for
-- them the next time somebody saves it.
INSERT INTO `branch_bank_account`
  (`branch_id`, `account_holder_name`, `bank_name`, `account_number`, `ifsc_code`, `position`, `created_at`, `updated_at`)
SELECT
  `id`,
  COALESCE(`bank_account_name`, ''),
  COALESCE(`bank_name`, ''),
  `bank_account_number`,
  COALESCE(`bank_ifsc`, ''),
  0,
  NOW(3),
  NOW(3)
FROM `branch`
WHERE `bank_account_number` IS NOT NULL AND TRIM(`bank_account_number`) <> ''
  -- Replayable. MySQL does not roll DDL back, so a failure between this copy and the column drop
  -- below leaves the rows written and the columns still standing; without this guard the re-run
  -- would copy every account a second time.
  AND NOT EXISTS (SELECT 1 FROM `branch_bank_account` WHERE `branch_bank_account`.`branch_id` = `branch`.`id`);

ALTER TABLE `branch`
  DROP COLUMN `bank_account_name`,
  DROP COLUMN `bank_name`,
  DROP COLUMN `bank_account_number`,
  DROP COLUMN `bank_ifsc`;
