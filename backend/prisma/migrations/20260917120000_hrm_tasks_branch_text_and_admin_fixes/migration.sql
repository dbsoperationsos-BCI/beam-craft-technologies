-- Six migrations from the same working session, combined into one file before push:
--
--   1. HRM task soft delete             (deleted_at column + index on hrm_task)
--   2. Task ids take the DBS- prefix    (task_code rewritten, TSK-000010 -> DBS-TK-00010)
--   3. A CRM lead's Assigned Branch text is repaired from its reference (second pass)
--   4. The same repair, extended to every other table that stores branch text beside branch_id
--   5. SUPER_ADMIN is granted every permission, scope and branch it was described as holding
--   6. Vizag is restored as a recognised alias for Visakhapatnam AP, and leads typed that way
--      while the alias was missing are re-filed under it
--
-- Each section below is that migration's original file, under its own heading.
--
-- ── Revised after this failed on production (error 1411) ─────────────────────────────────────
--
-- The first deploy of this file stopped on the fourth statement - the `sales_crm_lead` branch-text
-- repair - with:
--
--     Incorrect datetime value: '2026-31-11' for function str_to_date
--
-- Nothing is wrong with that statement. `sales_crm_lead` carries three **STORED** generated
-- columns - `created_day`, `follow_up_day`, `dob_edod_day` (20260903120000) - each of which parses
-- a free-text date column with `STR_TO_DATE`. MySQL recomputes every stored generated column on a
-- row whenever that row is updated, whatever column the update actually writes to. So an UPDATE
-- that only sets `assigned_branch` still re-parses that row's dates, and a lead holding an
-- impossible date - `11/31/2026`, which is no date in either day-first or month-first order - takes
-- the whole statement down with it.
--
-- It survived being written because the application's connection runs a lenient `sql_mode`, where
-- `STR_TO_DATE` answers NULL and a warning. Prisma's migration engine connects with
-- `STRICT_TRANS_TABLES`, where the same expression is a hard error. That is the whole asymmetry:
-- the row goes in quietly and detonates on the first UPDATE a migration makes.
--
-- Two changes, both verified against a copy of the real generated-column definition:
--
--   * **Section 0 is new.** It clears impossible dates out of those three columns before anything
--     touches the table, so the landmine is gone for this migration and for every future one.
--   * **Section 1 is now idempotent.** Statements 1 to 3 of the first attempt committed before
--     statement 4 failed (MySQL commits DDL implicitly and this file is not wrapped in one
--     transaction), so production already has `hrm_task.deleted_at` and its index. Re-running the
--     file as it stood would have died on `Duplicate column name`. It is guarded now, so the whole
--     file can be replayed against a database that has some of it, which is what recovering from a
--     half-applied migration actually needs.
--
-- Everything else is unchanged and was already safe to re-run.

-- ============================================================================================
-- 0. Clear impossible dates out of the leads table
-- ============================================================================================
--
-- A date that is the right *shape* but not a real day: `11/31/2026`, `31/04/2026`, `29/02/2025`,
-- `2026-02-31`, `2026-13-01`. Each matches one of the two patterns the generated columns accept and
-- then fails to parse, which is the only kind of value that can do this - text that matches nothing
-- (`not a date`, an empty cell, NULL) never reaches `STR_TO_DATE` and is perfectly safe.
--
-- The month and the day are checked with plain arithmetic, never by trying to parse the value
-- first: asking `STR_TO_DATE` whether something is a date is what raises the error this is here to
-- avoid. February is counted properly, leap year and all, so `29/02/2024` is kept and `29/02/2025`
-- is not.
--
-- Set to NULL, which is what the lead already reads as: the generated column computed NULL for
-- these rows all along, so no board, tab or filter sees any change. The text itself is lost, and
-- that is a real cost - this codebase's habit is to leave an unrecognised value alone precisely so
-- somebody can look at it. There is no choice here. While the value sits in the row, **no update to
-- that lead can succeed at all** - not this migration, not the lead popup, not a bulk edit - so
-- keeping it would mean keeping a record nobody can ever edit again. Run the SELECT in the
-- deployment notes first if you want to see what is about to go.
--
-- Slash dates are read day-first (`DD/MM/YYYY`), which is what the generated column does and what
-- this application decided long ago.
--
-- Idempotent: a second run matches nothing, because the values it matches no longer exist.

UPDATE `sales_crm_lead`
   SET `created_date` = NULL
 WHERE
  (
    `created_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`created_date`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`created_date`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`created_date`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `created_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`created_date`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`created_date`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`created_date`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  );

UPDATE `sales_crm_lead`
   SET `next_follow_up_date` = NULL
 WHERE
  (
    `next_follow_up_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`next_follow_up_date`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`next_follow_up_date`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`next_follow_up_date`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `next_follow_up_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`next_follow_up_date`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`next_follow_up_date`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`next_follow_up_date`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  );

UPDATE `sales_crm_lead`
   SET `date_of_birth_or_edod` = NULL
 WHERE
  (
    `date_of_birth_or_edod` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`date_of_birth_or_edod`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`date_of_birth_or_edod`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`date_of_birth_or_edod`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `date_of_birth_or_edod` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`date_of_birth_or_edod`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`date_of_birth_or_edod`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`date_of_birth_or_edod`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  );

-- ============================================================================================
-- 1. HRM task soft delete
-- ============================================================================================

-- Deleting a task, which until now could only be cancelled.
--
-- Cancelling says a real task was called off: the person holding it is told, the row stays in both
-- lists and it still counts. Deleting says the task should never have been raised - a duplicate, a
-- test, one typed against the wrong person - and there was no way to say that, so those rows sat in
-- the studio's list for good.
--
-- A column rather than a `DELETE`. A task carries its chain of holders, its activity log and the
-- files handed over with it, and a row removed outright would take the lot with it with nothing
-- left to answer "what happened to TSK-000123?". The module reads `deleted_at IS NULL` everywhere,
-- so a mistaken delete is a column somebody can clear rather than a restore from a backup.
--
-- Guarded rather than bare, so this file can be replayed against the production database that
-- already ran these two before statement 4 failed. MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so
-- the check is against `information_schema` and the statement is built from the answer; `DO 0` is
-- the do-nothing branch.
SET @add_deleted_at := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_task` ADD COLUMN `deleted_at` DATETIME(3) NULL',
    'DO 0')
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_task' AND COLUMN_NAME = 'deleted_at'
);
PREPARE add_deleted_at FROM @add_deleted_at;
EXECUTE add_deleted_at;
DEALLOCATE PREPARE add_deleted_at;

-- Every list the module answers starts "not deleted", so it is the first thing each of them
-- narrows by. Guarded for the same reason as the column above.
SET @add_deleted_at_idx := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `hrm_task_deleted_at_idx` ON `hrm_task` (`deleted_at`)',
    'DO 0')
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_task' AND INDEX_NAME = 'hrm_task_deleted_at_idx'
);
PREPARE add_deleted_at_idx FROM @add_deleted_at_idx;
EXECUTE add_deleted_at_idx;
DEALLOCATE PREPARE add_deleted_at_idx;

-- ============================================================================================
-- 2. Task ids take the DBS- prefix
-- ============================================================================================

-- Task ids join the studio's own shape: `DBS-TK-00001`, where they read `TSK-000001`.
--
-- Every other business id the application mints wears the `DBS-` prefix - `DBS-BK-DD-ERD-000001`,
-- `DBS-SID-DD-ERD-000001`, `DBS-EID-QQ-HYD-000007` - and a task was the one record answering to a
-- shape of its own. Unlike those it carries no vertical and no branch: a task names its department
-- and branch in its own columns, and work is regularly handed across both, so either baked into the
-- id would be wrong the first time a task moved.
--
-- The rows already raised are rewritten rather than left in the old shape, so the studio's list is
-- one format rather than two, and `TSK-000010` becomes `DBS-TK-00010` - the same number, five digits
-- instead of six. `task_code` is display and search only: every relation in the schema points at the
-- task's `id`, so nothing is re-pointed by this.
--
-- What is deliberately *not* rewritten is the text that quotes a code inside the activity log and
-- the notices already sent. Those are a record of what was said at the time, and editing them would
-- be rewriting history to match a rename.
--
-- Attachments stored before this keep their bucket keys, which contain the old code in the folder
-- name (`hrm/tasks/TSK-000010/...`). That key is stored per file on the task, so every existing file
-- still downloads; only files attached after this land under the new folder name.
--
-- `GREATEST(5, ...)` rather than a plain `LPAD(n, 5, '0')`, because LPAD does not only pad: given
-- something longer than the width it *truncates* it, so a six-digit `TSK-123456` would have become
-- `DBS-TK-12345` - a different task's number, and a collision waiting on the unique index. Five
-- digits is a minimum here, never a maximum, which is the same thing `padStart` does in the code
-- that mints the next one.
UPDATE `hrm_task`
   SET `task_code` = CONCAT(
         'DBS-TK-',
         LPAD(
           CAST(SUBSTRING(`task_code`, 5) AS UNSIGNED),
           GREATEST(5, CHAR_LENGTH(CAST(SUBSTRING(`task_code`, 5) AS UNSIGNED))),
           '0'
         )
       )
 WHERE `task_code` LIKE 'TSK-%';

-- ============================================================================================
-- 3. A CRM lead's Assigned Branch text is repaired from its reference (second pass)
-- ============================================================================================

-- A lead's Assigned Branch reads the way the branch register spells it - again.
--
-- 20260909160000 ran this exact statement and was right to. What it could not do was keep it true:
-- the CSV import and the sheet sync went on storing whatever the file typed, so every import since
-- has put the old spellings back - 3,667 leads reading `Vizag` on this studio's data by the time
-- this was written. The write paths resolve the name and the id from one match now
-- (`referenceMatchers`), which is what makes this the last time it needs running; this pass is for
-- the rows written in between.
--
-- `branch_id` beside the text has been right since the data-scope backfill: the matcher forgives a
-- first word, so a CSV or a sheet writing "Erode" was filed under `Erode TN` and every scoped read
-- narrowed correctly. The *text* was left as the file typed it, and that is what every screen shows
-- - including Assigned Branch in the lead popup and in Add Lead, which are pickers built from this
-- same branch table. A lead whose reference was right therefore showed a branch that matched no
-- option in the picker, which reads as a lead nobody has filed.
--
-- So the text is taken from the reference it already carries. Nothing is guessed here and no branch
-- name is written into this file: the join is to `branch`, and a lead whose `branch_id` is NULL -
-- text naming no branch the studio has - is deliberately left exactly as it is, because an
-- unrecognised value is something somebody has to look at rather than something to overwrite.
--
-- From here the write paths keep it that way: the CSV import, the sheet sync and every save through
-- the application resolve the name and the id from one match against this table.
UPDATE `sales_crm_lead` AS `lead`
  JOIN `branch` ON `branch`.`id` = `lead`.`branch_id`
   SET `lead`.`assigned_branch` = `branch`.`name`
 WHERE `lead`.`branch_id` IS NOT NULL
   AND (`lead`.`assigned_branch` IS NULL OR `lead`.`assigned_branch` <> `branch`.`name`);

-- ============================================================================================
-- 4. The same repair, extended to every other table that stores branch text beside branch_id
-- ============================================================================================

-- Every branch written beside a branch reference reads the way the register spells it.
--
-- This goes with the tightened branch rule in `referenceMatchers.js`: a branch is matched by its
-- full name, with or without the state keyword the register ends it with - `Erode TN` or `Erode` -
-- and by nothing shorter. One hard-coded spelling used to be forgiven, `Vizag` for
-- `Visakhapatnam AP`, and it is not any more, because a name written into the code that the branch
-- register has never heard of is the fault that rule exists to prevent.
--
-- The records already carrying such a spelling must not lose their branch over it. They do not need
-- to: each one holds the reference the old rule resolved, so the text is taken *from that reference*
-- rather than re-matched. A row whose `branch_id` is NULL is left exactly as it is - text naming no
-- branch the studio has is something somebody should look at, not something to overwrite.
--
-- `sales_crm_lead` is not here: 20260916170000 did it already, and it runs first. On this studio's
-- data that one row set is the whole of the problem - 3,667 leads typed `Vizag` - and the tables
-- below already read `Erode TN`, `Coimbatore TN` and so on. They are included anyway because that is
-- true of the data as it stands here, not of the data as it stands everywhere, and each of these
-- columns is filled from a picker built from the same register.
UPDATE `sales_project` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`source_branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND (`row`.`source_branch` IS NULL OR `row`.`source_branch` <> `branch`.`name`);

UPDATE `sales_quotation` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`source_branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND (`row`.`source_branch` IS NULL OR `row`.`source_branch` <> `branch`.`name`);

UPDATE `cash_entry` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND `row`.`branch` <> `branch`.`name`;

UPDATE `payment_request` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND `row`.`branch` <> `branch`.`name`;

UPDATE `hrm_task` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND (`row`.`branch` IS NULL OR `row`.`branch` <> `branch`.`name`);

UPDATE `sales_whatsapp_group_name` AS `row`
  JOIN `branch` ON `branch`.`id` = `row`.`branch_id`
   SET `row`.`branch` = `branch`.`name`
 WHERE `row`.`branch_id` IS NOT NULL AND `row`.`branch` <> `branch`.`name`;

-- ============================================================================================
-- 5. SUPER_ADMIN holds every permission, in every branch
-- ============================================================================================

-- SUPER_ADMIN holds every permission, in every branch.
--
-- The role exists, it is described as "Full access across every branch", and it was granted
-- **nothing**: no `role_permission` rows, no `role_branch` rows. Nobody noticed for as long as the
-- only person carrying it also had `user.role = 'SUPER_ADMIN'` on their login, because
-- `iamService` short-circuits on that column and hands out everything without reading a grant. The
-- moment the role was given to somebody whose login says `EMPLOYEE` - which is how the studio adds
-- an administrator - they got a role called SUPER_ADMIN that granted them nothing at all.
--
-- It cannot be fixed from the screen: SUPER_ADMIN is a **system role**, and Administration → Roles
-- refuses to change one ("Duplicate it to make an editable copy"). Nor by seeding: the seed does not
-- write grants, and it cannot be run on the VPS. So it is written here, which is the one route that
-- reaches production.
--
-- READ_WRITE on everything, which is what "full access" means - `ACCESS_LEVEL_RANK` in
-- `iam.service.js` ranks it above READ, so it satisfies every guard in the application.
--
-- Idempotent throughout: each statement inserts only what is missing (`LEFT JOIN … IS NULL`), so
-- running it against a database where somebody has already granted some of this adds the rest and
-- changes none of it. `UUID()` supplies the ids these tables need - they are `VARCHAR(191)` with no
-- default, because Prisma mints a cuid in the application and there is no application here.

-- Every permission the catalogue has put in the table, at the strongest level.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role`
  JOIN `permission` ON `permission`.`is_active` = 1
  LEFT JOIN `role_permission`
    ON `role_permission`.`roleId` = `role`.`id`
   AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN'
   AND `role_permission`.`id` IS NULL;

-- A permission's sub-actions - "Import", "Operate Intents" and the rest - which are offered as
-- checkboxes under it. A role holding the permission and none of its scopes holds the coarse half
-- of it, and this role is meant to hold all of it.
INSERT INTO `role_permission_scope` (`id`, `role_permission_id`, `scope_id`)
SELECT UUID(), `role_permission`.`id`, `permission_scope`.`id`
  FROM `role_permission`
  JOIN `role` ON `role`.`id` = `role_permission`.`roleId`
  JOIN `permission_scope`
    ON `permission_scope`.`permission_id` = `role_permission`.`permissionId`
   AND `permission_scope`.`is_active` = 1
  LEFT JOIN `role_permission_scope`
    ON `role_permission_scope`.`role_permission_id` = `role_permission`.`id`
   AND `role_permission_scope`.`scope_id` = `permission_scope`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN'
   AND `role_permission_scope`.`id` IS NULL;

-- Every branch the studio has. A role with no branches reaches nowhere, which is the other half of
-- why this role granted nothing: the permissions above would have been held in no branch at all.
--
-- Every branch, not only the active ones: a branch closed today is a branch whose records are still
-- read tomorrow, and the one role meant to reach everywhere must not lose them.
INSERT INTO `role_branch` (`id`, `role_id`, `branch_id`)
SELECT UUID(), `role`.`id`, `branch`.`id`
  FROM `role`
  JOIN `branch`
  LEFT JOIN `role_branch`
    ON `role_branch`.`role_id` = `role`.`id`
   AND `role_branch`.`branch_id` = `branch`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN'
   AND `role_branch`.`id` IS NULL;

-- ============================================================================================
-- 6. Vizag is Visakhapatnam AP again
-- ============================================================================================

-- The leads the studio typed `Vizag` on are filed under `Visakhapatnam AP` again.
--
-- 20260916180000 removed the one hard-coded branch spelling `referenceMatchers.js` forgave, on the
-- principle that the rule should read the branch register and nothing else. The consequence was not
-- the one intended: `Vizag` is not a guess at a branch the way `viza` or `erd` are, it is what this
-- studio calls that branch out loud and in every file it exports. So from that deploy on, a CSV or
-- a sheet saying `Vizag` produced a lead with a NULL `branch_id` and no Assigned Branch at all -
-- the picker in the lead popup and in Add Lead is built from the branch table, and `Vizag` matches
-- no option in it.
--
-- The alias is back, by the studio's own decision, as a named entry in `BRANCH_ALIASES`. This pass
-- is for the leads written while it was gone.
--
-- Two things are set, and only for a lead that has neither:
--
--   * `branch_id`, so every branch-scoped read counts the lead again. This is the half that was
--     actually broken - a lead filed under no branch is in nobody's branch.
--   * `assigned_branch`, taken from the branch row the id now points at, which is the same rule
--     20260916170000 applied and the same thing every write path does from here. It matters because
--     the board's Assigned Branch column and its filter read this text: leaving half the leads
--     reading `Vizag` and half `Visakhapatnam AP` would split one branch's leads across two filter
--     values, and neither would show all of them.
--
-- Unlike its predecessors this file does name a branch, because the alias *is* a name-to-name
-- mapping and there is nowhere else for it to come from. It is written once, matched case- and
-- space-insensitively, and joined to the register rather than assumed: a studio without a branch
-- called `Visakhapatnam AP` gets no rows updated rather than a lead pointed at an id that is not
-- there.
--
-- Deliberately narrow. Only a lead whose `branch_id` is NULL is touched, so a lead somebody has
-- since filed by hand is left alone, and only text that is exactly `Vizag` - a lead reading
-- `Vizag office` or `viza` still says so, because an unrecognised value is something somebody has
-- to look at rather than something to overwrite. Running it twice changes nothing the second time.
--
-- `sales_crm_lead` alone: it is the one table whose branch arrives as free text from a CSV or a
-- Google Sheet. Every other branch column in the application is filled from a picker built from the
-- register, so none of them can hold a nickname.
UPDATE `sales_crm_lead` AS `lead`
  JOIN `branch` ON LOWER(TRIM(`branch`.`name`)) = 'visakhapatnam ap'
   SET `lead`.`branch_id` = `branch`.`id`,
       `lead`.`assigned_branch` = `branch`.`name`
 WHERE `lead`.`branch_id` IS NULL
   AND LOWER(TRIM(`lead`.`assigned_branch`)) = 'vizag';
