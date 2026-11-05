-- The rounds a candidate has been called for, rather than only the last one.
--
-- The register held a single interview - one date, time, mode and Meet link - so a studio that sees
-- somebody twice had nowhere to put the second. Scheduling it **overwrote the first**, and with it
-- the only record that the candidate had already been in: nobody could say whether a Thursday
-- conversation was a first meeting or a third.
--
-- A JSON array of `{ round, interviewDate, interviewTime, interviewMode, meetLink }` in one LongText
-- column, the shape `education_entries`, `experience_entries` and `attachments` beside it already
-- use. Nothing queries a round across candidates, so a table of its own would buy nothing.
--
-- **The four flat columns stay and keep their meaning: they are the latest round.** The register's
-- table, the linked Google Sheets and the CSV importer all read one interview and none of them has
-- anywhere to put a list, so they go on reading the columns they always have - every write of a
-- round sets them from it. A row written before this column existed is therefore still correct with
-- `interview_rounds` NULL, which is exactly one round where a date is set and none where it is not.
--
-- Which round a candidate is on is deliberately **not** a column. It is the length of this list,
-- worked out when the row is read, so a count and the rounds behind it cannot drift apart - which
-- they would the first time anybody corrected a round by hand.
--
-- No permission changes: a column on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding a nullable column. Instant, and it takes no lock worth planning for.
--
-- Guarded against `information_schema` so the file can be replayed against a database that already
-- has the column.

SET @add_rounds := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `interview_rounds` LONGTEXT NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'interview_rounds'
);
PREPARE stmt FROM @add_rounds;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
