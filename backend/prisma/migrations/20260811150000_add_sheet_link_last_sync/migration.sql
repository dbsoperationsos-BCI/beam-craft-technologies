-- Records the outcome of the most recent sync for each linked sheet, so the Preview Import
-- panel can report when the sheet was last read. Kept as three columns updated in place
-- rather than a row per run: the background poller syncs every active link every 30 seconds.
--
-- Guarded because the module also adds these columns defensively at runtime
-- (ensureTableExists in google-sheet-links/controller.js), so a database that has served
-- traffic before this migration is applied already has them. MySQL has no
-- ADD COLUMN IF NOT EXISTS, hence the information_schema check.
--
-- The guard is a prepared statement per column rather than a stored procedure. `DELIMITER` is a
-- directive of the `mysql` command-line client, not SQL: Prisma sends each statement straight to
-- the server, which answers error 1064. This shape needs no custom delimiter, so it applies the
-- same way through Prisma, through the CLI, and on a database that already has the columns.

SET @add_lastSyncedAt := IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'SalesGoogleSheetLink'
      AND column_name = 'lastSyncedAt') = 0,
  'ALTER TABLE `SalesGoogleSheetLink` ADD COLUMN `lastSyncedAt` DATETIME(3) NULL',
  'DO 0'
);
PREPARE add_lastSyncedAt FROM @add_lastSyncedAt;
EXECUTE add_lastSyncedAt;
DEALLOCATE PREPARE add_lastSyncedAt;

SET @add_lastSyncStatus := IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'SalesGoogleSheetLink'
      AND column_name = 'lastSyncStatus') = 0,
  'ALTER TABLE `SalesGoogleSheetLink` ADD COLUMN `lastSyncStatus` VARCHAR(30) NULL',
  'DO 0'
);
PREPARE add_lastSyncStatus FROM @add_lastSyncStatus;
EXECUTE add_lastSyncStatus;
DEALLOCATE PREPARE add_lastSyncStatus;

SET @add_lastSyncSummary := IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'SalesGoogleSheetLink'
      AND column_name = 'lastSyncSummary') = 0,
  'ALTER TABLE `SalesGoogleSheetLink` ADD COLUMN `lastSyncSummary` TEXT NULL',
  'DO 0'
);
PREPARE add_lastSyncSummary FROM @add_lastSyncSummary;
EXECUTE add_lastSyncSummary;
DEALLOCATE PREPARE add_lastSyncSummary;
