-- Brings a database that already ran past `20260807120000_add_sales_google_sheet_links` up to the
-- indexes `schema.prisma` declares for `SalesGoogleSheetLink`.
--
-- That migration now guards its own index creation, but a guard only helps a database that has yet
-- to apply it. Where it is already recorded as applied - and on the databases this matters for it is
-- recorded with `applied_steps_count = 0`, meaning it was resolved rather than run, because the
-- runtime's `ensureTableExists` had already created the table - Prisma will not run it again. So the
-- repair has to arrive as a migration of its own, at the end of the chain.
--
-- Three indexes are missing on such a database: `systemTableId` and `branch` were added to the table
-- by plain `ALTER TABLE ... ADD COLUMN`, which creates no index, and `googleAccountConnectionId`
-- likewise. Each is created only when absent, so this is a no-op on a database built from the
-- migration chain, and it adds nothing that is not already in the schema.

SET @ix_systemTableId := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_systemTableId_idx');
SET @sql_ix_systemTableId := IF(@ix_systemTableId = 0,
  'CREATE INDEX `SalesGoogleSheetLink_systemTableId_idx` ON `SalesGoogleSheetLink` (`systemTableId`)', 'DO 0');
PREPARE stmt_ix_systemTableId FROM @sql_ix_systemTableId;
EXECUTE stmt_ix_systemTableId;
DEALLOCATE PREPARE stmt_ix_systemTableId;

SET @ix_branch := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_branch_idx');
SET @sql_ix_branch := IF(@ix_branch = 0,
  'CREATE INDEX `SalesGoogleSheetLink_branch_idx` ON `SalesGoogleSheetLink` (`branch`)', 'DO 0');
PREPARE stmt_ix_branch FROM @sql_ix_branch;
EXECUTE stmt_ix_branch;
DEALLOCATE PREPARE stmt_ix_branch;

SET @ix_googleAccountConnectionId := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_googleAccountConnectionId_idx');
SET @sql_ix_googleAccountConnectionId := IF(@ix_googleAccountConnectionId = 0,
  'CREATE INDEX `SalesGoogleSheetLink_googleAccountConnectionId_idx` ON `SalesGoogleSheetLink` (`googleAccountConnectionId`)', 'DO 0');
PREPARE stmt_ix_googleAccountConnectionId FROM @sql_ix_googleAccountConnectionId;
EXECUTE stmt_ix_googleAccountConnectionId;
DEALLOCATE PREPARE stmt_ix_googleAccountConnectionId;
