-- Where a cash entry came from: Manual, CSV Import or PDF Import.
--
-- Nullable and with no default: every entry already recorded is left NULL, because whether it was
-- typed in or imported was never kept, and writing "Manual" on them would be a guess. New entries
-- are given their source by the code that writes them.
--
-- One nullable column added, no existing value changed, so there is nothing to fail on production data.

ALTER TABLE `cash_entry` ADD COLUMN `source` VARCHAR(20) NULL;
