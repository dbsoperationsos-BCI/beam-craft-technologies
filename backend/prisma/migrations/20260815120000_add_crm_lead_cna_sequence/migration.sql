-- How many unanswered attempts a CRM lead has had.
--
-- The CRM has been sending this number with every CNA save, but there was no column to put it
-- in, so it was dropped and the count always read back as zero. That is what made CNA look
-- like it was not working: the label never moved past "CNA (1)" and the lead was never
-- rejected for going unanswered.
--
-- Nullable, so every existing lead starts with no attempts recorded, which is correct - none
-- of them have a history that was kept.
--
-- `cnaSequence` is one of `CRM_LEAD_SQL_COLUMNS`, so `ensureCrmLeadColumnsNow` creates it at boot
-- as `TEXT NULL` on any database whose API has run, and a plain ADD COLUMN answered error 1060
-- there. `TEXT` is what `schema.prisma` declares for it, so the runtime's column is already the
-- right shape and only the guard is needed.
SET @has_cnaSequence := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesCrmLead' AND column_name = 'cnaSequence');
SET @sql_cnaSequence := IF(@has_cnaSequence = 0,
  'ALTER TABLE `SalesCrmLead` ADD COLUMN `cnaSequence` TEXT NULL',
  'DO 0');
PREPARE stmt_cnaSequence FROM @sql_cnaSequence;
EXECUTE stmt_cnaSequence;
DEALLOCATE PREPARE stmt_cnaSequence;
