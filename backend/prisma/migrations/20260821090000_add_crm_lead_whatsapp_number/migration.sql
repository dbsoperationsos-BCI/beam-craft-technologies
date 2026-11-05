-- The number a client is messaged on, which is not always the one they enquired from: a landline,
-- an office line, or a second phone. Asked for on every vertical, beside Contact.
--
-- Nullable and untouched for every existing lead: nobody has been asked for it until now, and a
-- blank here means "not asked" rather than "no WhatsApp".
--
-- Added conditionally because this module also adds its own columns at runtime - `ensureCrmLeadColumns`
-- ALTERs in anything listed in `crmLeadColumns.js` that the table does not have yet. A server that
-- booted with the new code before this migration ran already has the column, and MySQL has no
-- `ADD COLUMN IF NOT EXISTS`, so an unconditional ALTER fails with error 1060 and stalls every
-- migration behind it.
SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'sales_crm_lead'
     AND column_name = 'whatsapp_number'
);
SET @statement := IF(
  @column_exists = 0,
  'ALTER TABLE `sales_crm_lead` ADD COLUMN `whatsapp_number` TEXT NULL',
  'DO 0'
);
PREPARE add_column FROM @statement;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
