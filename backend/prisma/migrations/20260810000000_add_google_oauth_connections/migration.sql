-- The linked Google account a sheet syncs on behalf of, and the one-shot state a consent
-- redirect is checked against.
--
-- All three objects below are also created by the runtime: `ensureTableExists`
-- (google-sheet-links/controller.js) adds `googleAccountConnectionId` and `spreadsheetName` to
-- `SalesGoogleSheetLink`, and `ensureConnectionTableExists` / `ensureOAuthStateTableExists`
-- (google-oauth/service.js) create the two tables with `CREATE TABLE IF NOT EXISTS`. On a database
-- whose API has served traffic the columns answered error 1060, duplicate column, the index 1061,
-- duplicate key, and the tables 1050, table already exists. Each is guarded so the migration and the
-- runtime reach the same place whichever of them ran first.

SET @has_googleAccountConnectionId := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND column_name = 'googleAccountConnectionId');
SET @sql_googleAccountConnectionId := IF(@has_googleAccountConnectionId = 0,
  'ALTER TABLE `SalesGoogleSheetLink` ADD COLUMN `googleAccountConnectionId` VARCHAR(191) NULL AFTER `id`', 'DO 0');
PREPARE stmt_googleAccountConnectionId FROM @sql_googleAccountConnectionId;
EXECUTE stmt_googleAccountConnectionId;
DEALLOCATE PREPARE stmt_googleAccountConnectionId;

SET @has_spreadsheetName := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND column_name = 'spreadsheetName');
SET @sql_spreadsheetName := IF(@has_spreadsheetName = 0,
  'ALTER TABLE `SalesGoogleSheetLink` ADD COLUMN `spreadsheetName` VARCHAR(255) NULL AFTER `spreadsheetId`', 'DO 0');
PREPARE stmt_spreadsheetName FROM @sql_spreadsheetName;
EXECUTE stmt_spreadsheetName;
DEALLOCATE PREPARE stmt_spreadsheetName;

SET @ix_googleAccountConnectionId := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'SalesGoogleSheetLink' AND index_name = 'SalesGoogleSheetLink_googleAccountConnectionId_idx');
SET @sql_ix_googleAccountConnectionId := IF(@ix_googleAccountConnectionId = 0,
  'CREATE INDEX `SalesGoogleSheetLink_googleAccountConnectionId_idx` ON `SalesGoogleSheetLink` (`googleAccountConnectionId`)', 'DO 0');
PREPARE stmt_ix_googleAccountConnectionId FROM @sql_ix_googleAccountConnectionId;
EXECUTE stmt_ix_googleAccountConnectionId;
DEALLOCATE PREPARE stmt_ix_googleAccountConnectionId;

-- Identical to `CREATE_CONNECTION_TABLE_SQL` in google-oauth/service.js, indexes included, so a
-- table created by either route is the same table.
CREATE TABLE IF NOT EXISTS `SalesGoogleAccountConnection` (
  `id` VARCHAR(191) NOT NULL,
  `userId` INTEGER NOT NULL,
  `googleAccountId` VARCHAR(191) NOT NULL,
  `googleEmail` VARCHAR(191) NOT NULL,
  `googleDisplayName` VARCHAR(191) NULL,
  `accessTokenEncrypted` TEXT NULL,
  `refreshTokenEncrypted` TEXT NULL,
  `tokenExpiresAt` DATETIME(3) NULL,
  `scopes` TEXT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'CONNECTED',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `SalesGoogleAccountConnection_userId_key` (`userId`),
  INDEX `SalesGoogleAccountConnection_googleAccountId_idx` (`googleAccountId`),
  INDEX `SalesGoogleAccountConnection_googleEmail_idx` (`googleEmail`),
  INDEX `SalesGoogleAccountConnection_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Identical to `CREATE_OAUTH_STATE_TABLE_SQL` in google-oauth/service.js, for the same reason.
CREATE TABLE IF NOT EXISTS `SalesGoogleOAuthState` (
  `id` VARCHAR(191) NOT NULL,
  `stateHash` CHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL,
  `purpose` VARCHAR(30) NOT NULL DEFAULT 'connect',
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `SalesGoogleOAuthState_stateHash_key` (`stateHash`),
  INDEX `SalesGoogleOAuthState_userId_expiresAt_idx` (`userId`, `expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
