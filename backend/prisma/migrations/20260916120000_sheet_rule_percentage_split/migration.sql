-- Sharing a rule's leads between several people, by percentage.
--
-- A rule named one employee, so a column value that two people work between them could not be
-- written down at all: the studio picked one of them and moved leads by hand afterwards, which is
-- the job these rules exist to end.
--
-- One row per person on a rule, with the share they take. `percent` is exactly what the studio
-- typed - nothing computes or adjusts it - and the shares on a rule add to 100.
--
-- `assigned_count` is how the percentage is actually honoured. A lead cannot be split 60/40; only a
-- run of leads can, so the allocator has to remember what it has handed out: each new lead goes to
-- whoever is furthest below their share, which converges on the configured proportions rather than
-- drifting. Stored rather than held in memory, because the poller re-reads every two minutes and a
-- counter that restarted each pass would give a sheet gaining three rows at a time all three to the
-- first person. Stored rather than counted off the leads, because a manager reassigning a lead by
-- hand is expected here, and the split would then chase those edits instead of the configuration.
--
-- ── Written to run against a database that has already been part-way here ──
--
-- `rulesStore.js` bootstraps these tables with CREATE TABLE IF NOT EXISTS, for an environment that
-- has not migrated yet - so by the time this runs the target table may already exist, and the
-- columns it copies from may already be gone. Every step is therefore conditional. That is not
-- belt and braces: an unguarded CREATE here failed on exactly that, in development.

CREATE TABLE IF NOT EXISTS `sales_google_sheet_assignment_rule_target` (
  `id`             VARCHAR(191) NOT NULL,
  `rule_id`        VARCHAR(191) NOT NULL,
  `position`       INT          NOT NULL DEFAULT 0,
  `employee_id`    INT          NULL,
  `employee_name`  VARCHAR(150) NOT NULL DEFAULT '',
  `percent`        INT          NOT NULL DEFAULT 100,
  `assigned_count` INT          NOT NULL DEFAULT 0,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- One person appears once on a rule. Two rows for the same person are one total typed twice.
  UNIQUE INDEX `sales_google_sheet_rule_target_rule_employee` (`rule_id`, `employee_id`),
  INDEX `sales_google_sheet_rule_target_rule_id_idx` (`rule_id`),
  -- Answers "which splits name this employee" when somebody is offboarded.
  INDEX `sales_google_sheet_rule_target_employee_id_idx` (`employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every rule that names somebody becomes that person at 100%, only where the column is still there
-- to be read and only for rules that have no share yet, so running this twice adds nothing.
SET @has_target_column := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sales_google_sheet_assignment_rule'
    AND column_name = 'target_employee_id'
);
SET @backfill := IF(@has_target_column > 0,
  'INSERT INTO `sales_google_sheet_assignment_rule_target`
     (`id`, `rule_id`, `position`, `employee_id`, `employee_name`, `percent`, `assigned_count`)
   SELECT CONCAT(r.`id`, ''-t0''), r.`id`, 0, r.`target_employee_id`, r.`target_employee_name`, 100, 0
   FROM `sales_google_sheet_assignment_rule` r
   WHERE r.`target_employee_id` IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM `sales_google_sheet_assignment_rule_target` t WHERE t.`rule_id` = r.`id`)',
  'DO 0');
PREPARE backfill_stmt FROM @backfill;
EXECUTE backfill_stmt;
DEALLOCATE PREPARE backfill_stmt;

-- The employee moves off the rule onto its shares. Dropped only once the copy above has run.
SET @drop_index := IF((
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_google_sheet_assignment_rule'
      AND index_name = 'sales_google_sheet_assignment_rule_target_employee_id_idx'
  ) > 0,
  'ALTER TABLE `sales_google_sheet_assignment_rule` DROP INDEX `sales_google_sheet_assignment_rule_target_employee_id_idx`',
  'DO 0');
PREPARE drop_index_stmt FROM @drop_index;
EXECUTE drop_index_stmt;
DEALLOCATE PREPARE drop_index_stmt;

SET @drop_id := IF(@has_target_column > 0,
  'ALTER TABLE `sales_google_sheet_assignment_rule` DROP COLUMN `target_employee_id`', 'DO 0');
PREPARE drop_id_stmt FROM @drop_id;
EXECUTE drop_id_stmt;
DEALLOCATE PREPARE drop_id_stmt;

SET @has_name_column := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sales_google_sheet_assignment_rule'
    AND column_name = 'target_employee_name'
);
SET @drop_name := IF(@has_name_column > 0,
  'ALTER TABLE `sales_google_sheet_assignment_rule` DROP COLUMN `target_employee_name`', 'DO 0');
PREPARE drop_name_stmt FROM @drop_name;
EXECUTE drop_name_stmt;
DEALLOCATE PREPARE drop_name_stmt;

-- `operator` held the condition - equals, contains, is any of - the rules briefly had. A database
-- created before it was removed still carries it, which is enough to make Prisma report drift.
SET @has_operator := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sales_google_sheet_assignment_rule'
    AND column_name = 'operator'
);
SET @drop_operator := IF(@has_operator > 0,
  'ALTER TABLE `sales_google_sheet_assignment_rule` DROP COLUMN `operator`', 'DO 0');
PREPARE drop_operator_stmt FROM @drop_operator;
EXECUTE drop_operator_stmt;
DEALLOCATE PREPARE drop_operator_stmt;
