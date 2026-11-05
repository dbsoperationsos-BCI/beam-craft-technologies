-- What the candidate says about the studio, in their own words.
--
-- The application form ended with one box - "Anything you would like us to know" - which is a
-- question with no shape: it came back empty, or holding a covering letter, or a phone number
-- already asked for three fields above. Two questions replace it, and each has an answer somebody
-- can actually give:
--
--   * `how_you_know_us` - how they came to hear of the studio.
--   * `about_us`        - what they know about it, which is the cheapest read there is on whether
--                         somebody is applying to this studio or to forty of them.
--
-- `how_you_know_us` is deliberately **not** the `source` column that already exists. That one is
-- the studio's own answer to where a row came from - "Meta Ads", set by a linked sheet's assignment
-- rules, filtered on in the register - and letting a candidate write into it would let one
-- submission overwrite what the import established. That is the same fault the form avoided by no
-- longer sending `department`, and the two are genuinely different questions: which channel the row
-- arrived through, and how the person says they heard of the place. A Meta lead who answers "my
-- cousin works there" is both, and neither answer should erase the other.
--
-- `remarks` is untouched and keeps its meaning: HR's own note on the candidate, written on the
-- record. The form simply stops writing into it, so a studio's note can no longer be overwritten by
-- a candidate re-submitting their link.
--
-- No permission changes: columns on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding two nullable columns. Instant, and it takes no lock worth planning for.
--
-- Guarded against `information_schema` so the file can be replayed against a database that already
-- has either column.

SET @add_how := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `how_you_know_us` VARCHAR(1000) NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'how_you_know_us'
);
PREPARE stmt FROM @add_how;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_about := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `about_us` TEXT NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'about_us'
);
PREPARE stmt FROM @add_about;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
