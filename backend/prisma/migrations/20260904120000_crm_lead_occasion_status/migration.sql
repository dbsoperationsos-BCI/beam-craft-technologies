-- One occasion of one Qua Qua lead, and how that call is going.
--
-- Qua Qua shoots children, and the same client is worth calling more than once: a newborn window
-- around the estimated delivery date, and a birthday window before the child's next birthday. Both
-- are read off "Date of Birth (or) EDOD", and both are a fresh enquiry rather than a continuation of
-- whatever was sold before.
--
-- Writing such a call's status onto the lead's own `status` would overwrite what the previous shoot
-- ended as, and would stop the lead ever returning to Yet to connect next year - this year's status
-- would still be sitting there. So an occasion is its own row, keyed by the lead, which occasion it
-- is, and the calendar year it falls in.
--
-- A year with no row is an occasion nobody has connected about, which is what the Yet to connect tab
-- lists; nothing has to be written in advance for one to appear there.
CREATE TABLE `sales_crm_lead_occasion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `enquiry_id` VARCHAR(100) NOT NULL,
  -- "NEWBORN" or "BIRTHDAY".
  `occasion` VARCHAR(20) NOT NULL,
  -- The delivery's year for a newborn, the birthday's own year for a birthday. Not the year of birth.
  `occasion_year` INTEGER NOT NULL,
  `status` VARCHAR(191) NULL,
  -- The trimmed, lowercased status, exactly as `sales_crm_lead`.`status_key` holds it, so the
  -- board's tab clauses can compare an occurrence and a lead the same way.
  `status_key` VARCHAR(60) NULL,
  `cna_sequence` INTEGER NOT NULL DEFAULT 0,
  `next_follow_up_date` VARCHAR(40) NULL,
  `next_follow_up_time` VARCHAR(20) NULL,
  -- `next_follow_up_date` as a real date, so the follow-up tabs compare it the way they compare the
  -- lead's own `follow_up_day`.
  `follow_up_day` DATE NULL,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  -- One occurrence per lead per occasion per year - the key every read and write addresses one by,
  -- and what makes the board's per-row lookup a unique-index hit rather than a scan.
  UNIQUE INDEX `sales_crm_lead_occasion_lead_key`(`enquiry_id`, `occasion`, `occasion_year`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
