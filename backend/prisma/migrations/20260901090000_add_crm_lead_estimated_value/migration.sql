-- What the studio reckons a lead is worth, asked for on every vertical.
--
-- Distinct from the two budget columns beside it: `preferred_budget` and `expected_budget` are what
-- the client said they wanted to spend, this is what the studio estimates the work will come to.
--
-- Nullable and untouched for every existing lead. It is mandatory on the form from now on, which
-- applies to leads being captured and edited; the rows already in the table keep their blank until
-- somebody opens them, and a blank here means "not estimated yet" rather than "worth nothing".
--
-- Added conditionally because this module also adds its own columns at runtime -
-- `ensureCrmLeadColumns` ALTERs in anything listed in `crmLeadColumns.js` that the table does not
-- have yet. A server that booted with the new code before this migration ran already has the
-- column, and MySQL has no `ADD COLUMN IF NOT EXISTS`, so an unconditional ALTER fails with error
-- 1060 and stalls every migration behind it.
SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'sales_crm_lead'
     AND column_name = 'estimated_value'
);
SET @statement := IF(
  @column_exists = 0,
  'ALTER TABLE `sales_crm_lead` ADD COLUMN `estimated_value` TEXT NULL',
  'DO 0'
);
PREPARE add_column FROM @statement;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
