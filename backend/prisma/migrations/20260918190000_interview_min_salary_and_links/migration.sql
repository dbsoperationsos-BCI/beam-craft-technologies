-- What a candidate would actually accept, and the up-to-three links they apply with.
--
-- ── `min_expected_ctc` ────────────────────────────────────────────────────────────────────────
--
-- The register held one salary the candidate named, `expected_ctc`, which is the opening ask. The
-- number that decides whether a conversation is worth having at all is the other one - the lowest
-- they would take - and HR was learning it on a call that a band could have settled beforehand. Two
-- columns rather than a "3-5 LPA" string in one, because they are read as two numbers: a studio
-- filters on the floor and negotiates against the ask.
--
-- ── `portfolio_links` ─────────────────────────────────────────────────────────────────────────
--
-- A photographer or an editor applies with more than one link - a portfolio site, an Instagram, a
-- Drive folder - and the form had a single box, so the other two went into Remarks or nowhere. The
-- list is a JSON array of up to three URL strings in one LongText column, the shape
-- `education_entries` and `experience_entries` beside it already use: nothing reads a link apart
-- from the record it belongs to, so a table of its own would buy nothing.
--
-- `portfolio_url` is **kept and keeps its meaning**: it is the first of the links. The register's
-- own table column, the linked Google Sheets and the CSV importer all read a single link and none
-- of them has a place to put three, so they go on reading the column they always have - the
-- submission writes the first link into it as well as into the list. Every row already written is
-- therefore still correct with `portfolio_links` NULL, which is exactly one link and no list.
--
-- No permission changes: these are columns on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding two nullable columns. Instant, and it takes no lock worth planning for.
--
-- Guarded against `information_schema` so the file can be replayed against a database that already
-- has either column - the same arrangement the CRM date-column migration in this release uses.

SET @add_min_ctc := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `min_expected_ctc` VARCHAR(60) NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'min_expected_ctc'
);
PREPARE stmt FROM @add_min_ctc;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_links := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `portfolio_links` LONGTEXT NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'portfolio_links'
);
PREPARE stmt FROM @add_links;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
