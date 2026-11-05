-- Why a candidate was selected, held or turned down - and the stage that says they started.
--
-- ── `status_notes` ────────────────────────────────────────────────────────────────────────────
--
-- Moving a candidate to Selected, On Hold or Rejected is the decision the whole register exists to
-- reach, and it was the one thing recorded without a reason: the stage changed on the row and the
-- why lived in somebody's head, or was typed into `remarks` over whatever was already there.
--
-- A JSON array of `{ status, note, at }`, one entry per decision, newest last - the shape
-- `interview_rounds`, `education_entries` and `attachments` beside it already use. It is a **list**
-- because a candidate can be held in March and rejected in May, and each decision has its own
-- reason that the other must not overwrite.
--
-- Deliberately apart from `remarks`, which stays HR's running note on the person. Folding the two
-- together meant either losing the earlier reason or appending until nobody could tell which
-- sentence went with which stage.
--
-- ── The `Onboarded` stage ─────────────────────────────────────────────────────────────────────
--
-- No schema change: the status column is free text and the stage list is code, so this migration
-- only records the decision. **Onboarded** sits after Selected because the two are different
-- answers, and the gap between them is where hiring most often goes wrong - somebody offered a job
-- has not necessarily accepted it, and a register that stopped at Selected could not tell an offer
-- still out from one already turned up for. That gap was being tracked in Remarks or in nobody's
-- records at all.
--
-- No permission changes: a column on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding a nullable column. Instant, and it takes no lock worth planning for.
--
-- Guarded against `information_schema` so the file can be replayed against a database that already
-- has the column.

SET @add_status_notes := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `status_notes` LONGTEXT NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'status_notes'
);
PREPARE stmt FROM @add_status_notes;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
