-- The mode an entry was actually paid by when the mode chosen was "Other".
--
-- The form has always asked for it, the Accounts table has always had a "Payment Mode Details"
-- column reading it and the controller has always written it — but the column itself was never
-- added, so Prisma refused the field and every cash entry create and update failed.
--
-- Nullable, and no backfill: the entries recorded before this were paid by one of the five named
-- modes, none of which carries a detail.
ALTER TABLE `cash_entry` ADD COLUMN `payment_mode_other` VARCHAR(120) NULL;
