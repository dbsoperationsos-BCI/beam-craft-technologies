-- Three more lists the studio could not edit, each written into the code where it was read.
--
--   * the payment schedule's Category on Bookings & Converted, an array in SchedulePaymentSection.js;
--   * the Payment Mode on an Accounts cash entry and an HRM payment request, written out twice over -
--     once in accountsConfig.js and again in cash-entries/controller.js, where it validates;
--   * the Tier the W/A Group Name generator puts into the name it mints.
--
-- The flags are the point, as they were for the employee statuses. `settles_balance` is the meaning
-- behind "Final Settlement": the row that closes a schedule is pinned to the bottom, cannot be
-- removed, and is what the remaining percentage settles against - compared against that literal
-- string in three places, so renaming it stopped all three working. `asks_for_transaction_id`,
-- `asks_for_account` and `asks_for_details` are what each way of moving money asks for, which were
-- three more arrays. With the meaning on the row the lists can be edited and the behaviour follows.
--
-- Seeded with exactly what the arrays held, so nothing already recorded stops matching. Written by
-- hand and applied with `prisma migrate deploy`.

CREATE TABLE `payment_schedule_category` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `settles_balance` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_schedule_category_code_key`(`code`),
  INDEX `psc_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_mode` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `asks_for_transaction_id` BOOLEAN NOT NULL DEFAULT false,
  `asks_for_account` BOOLEAN NOT NULL DEFAULT false,
  `asks_for_details` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_mode_code_key`(`code`),
  INDEX `payment_mode_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tier` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `tier_code_key`(`code`),
  INDEX `tier_active_sort_idx`(`is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The payment schedule's four, in the order the booking screen offered them. Only "Final Settlement"
-- settles: it is the row pinned to the bottom that the remaining percentage is settled against.
INSERT INTO `payment_schedule_category` (`code`, `name`, `settles_balance`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'ADVANCE' AS `code`, 'Advance' AS `name`, false AS `settles_balance`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'PARTIAL_PAYMENT', 'Partial Payment', false, 1, NOW(3)
  UNION ALL SELECT 'EXTRAS_SERVICES', 'Extras Services', false, 2, NOW(3)
  UNION ALL SELECT 'FINAL_SETTLEMENT', 'Final Settlement', true, 3, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `payment_schedule_category` `existing`);

-- The six modes with what each asks for. UPI, Bank Transfer and Net Banking carry a reference;
-- Bank Transfer, Net Banking and Cards move through an account; Cash asks for neither, and Other is
-- the way out for anything the named modes do not cover and says what it actually was.
INSERT INTO `payment_mode` (`code`, `name`, `asks_for_transaction_id`, `asks_for_account`, `asks_for_details`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'UPI' AS `code`, 'UPI' AS `name`, true AS `a`, false AS `b`, false AS `c`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'BANK_TRANSFER', 'Bank Transfer', true, true, false, 1, NOW(3)
  UNION ALL SELECT 'NET_BANKING', 'Net Banking', true, true, false, 2, NOW(3)
  UNION ALL SELECT 'CASH', 'Cash', false, false, false, 3, NOW(3)
  UNION ALL SELECT 'CREDIT_DEBIT_CARDS', 'Credit / Debit Cards', false, true, false, 4, NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', false, false, true, 5, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `payment_mode` `existing`);

-- The five tiers the group name generator offered.
INSERT INTO `tier` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'T1' AS `code`, '1t1' AS `name`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'T2', '2t2', 1, NOW(3)
  UNION ALL SELECT 'T3', '3t3', 2, NOW(3)
  UNION ALL SELECT 'T4', '4t4', 3, NOW(3)
  UNION ALL SELECT 'T5', '5t5', 4, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `tier` `existing`);
