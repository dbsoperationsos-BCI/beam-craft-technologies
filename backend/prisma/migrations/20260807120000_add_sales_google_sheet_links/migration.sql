-- The Google Sheets links the CRM syncs from.
--
-- `ensureTableExists` (google-sheet-links/controller.js) creates this table at runtime with
-- `CREATE TABLE IF NOT EXISTS`, so on any database whose API has served traffic it is already
-- there and a plain `CREATE TABLE` answered error 1050, table already exists. `IF NOT EXISTS` here
-- as well, so the migration and the runtime cannot fight over which of them got there first.
CREATE TABLE IF NOT EXISTS `SalesGoogleSheetLink` (
    `id` VARCHAR(191) NOT NULL,
    `systemTableName` VARCHAR(191) NOT NULL,
    `systemTableId` VARCHAR(191) NOT NULL DEFAULT '',
    `branch` VARCHAR(191) NOT NULL DEFAULT '',
    `sheetUrl` VARCHAR(1000) NOT NULL,
    `spreadsheetId` VARCHAR(191) NULL,
    `targetedTab` VARCHAR(191) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    `createdByUserId` INTEGER NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesGoogleSheetLink_systemTableName_idx`(`systemTableName`),
    INDEX `SalesGoogleSheetLink_systemTableId_idx`(`systemTableId`),
    INDEX `SalesGoogleSheetLink_branch_idx`(`branch`),
    INDEX `SalesGoogleSheetLink_deletedAt_idx`(`deletedAt`),
    INDEX `SalesGoogleSheetLink_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The indexes again, one at a time, for the database that already had the table.
--
-- An earlier version of the runtime's `CREATE TABLE` carried fewer of them, and `systemTableId` and
-- `branch` arrived later as plain `ALTER TABLE ... ADD COLUMN`, which adds no index. So a database
-- the runtime created is missing indexes that `schema.prisma` declares - the development database is
-- missing three - and `CREATE TABLE IF NOT EXISTS` above skips the whole statement rather than
-- filling them in. Added here when absent, which is what makes a runtime-created table and a
-- migration-created one end up the same shape.

SET @ix_systemTableName := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_systemTableName_idx');
SET @sql_ix_systemTableName := IF(@ix_systemTableName = 0,
  'CREATE INDEX `SalesGoogleSheetLink_systemTableName_idx` ON `SalesGoogleSheetLink` (`systemTableName`)', 'DO 0');
PREPARE stmt_ix_systemTableName FROM @sql_ix_systemTableName;
EXECUTE stmt_ix_systemTableName;
DEALLOCATE PREPARE stmt_ix_systemTableName;

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

SET @ix_deletedAt := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_deletedAt_idx');
SET @sql_ix_deletedAt := IF(@ix_deletedAt = 0,
  'CREATE INDEX `SalesGoogleSheetLink_deletedAt_idx` ON `SalesGoogleSheetLink` (`deletedAt`)', 'DO 0');
PREPARE stmt_ix_deletedAt FROM @sql_ix_deletedAt;
EXECUTE stmt_ix_deletedAt;
DEALLOCATE PREPARE stmt_ix_deletedAt;

SET @ix_createdAt := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_createdAt_idx');
SET @sql_ix_createdAt := IF(@ix_createdAt = 0,
  'CREATE INDEX `SalesGoogleSheetLink_createdAt_idx` ON `SalesGoogleSheetLink` (`createdAt`)', 'DO 0');
PREPARE stmt_ix_createdAt FROM @sql_ix_createdAt;
EXECUTE stmt_ix_createdAt;
DEALLOCATE PREPARE stmt_ix_createdAt;
