-- Anything the candidate attaches besides the résumé.
--
-- The application form took exactly one file. A candidate with a certificate, an award letter, a
-- scanned portfolio or an experience letter had nowhere to put it, so those either went into the
-- portfolio link as a Drive folder or were emailed separately and lost from the record.
--
-- A JSON array of `{ name, url }` in one LongText column - the shape `storeDocument` already
-- returns and the shape `education_entries`, `experience_entries` and `portfolio_links` beside it
-- already use. A table of its own would buy nothing: nothing reads an attachment apart from the
-- candidate it belongs to, and there is no query that asks for attachments across candidates.
--
-- The files themselves are **not** in this column. They go to Cloudflare R2 through the shared
-- `storeDocument`, which is what the résumé already does, and only the returned URL and the name
-- the candidate's own file carried are stored here. Documents are uploaded as they are - the 5 MB
-- cap is the guard, not re-encoding - because compressing a PDF or a scanned certificate would
-- damage the one thing it is being read for; browser-side resampling belongs to the image fields.
--
-- `resume_url` is untouched and goes on holding the résumé on its own. It is one file, it is the
-- one every candidate has, and the register shows it as its own column.
--
-- No permission changes: a column on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding a nullable column. Instant, and it takes no lock worth planning for.
--
-- Guarded against `information_schema` so the file can be replayed against a database that already
-- has the column.

SET @add_attachments := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `hrm_interview_candidate` ADD COLUMN `attachments` LONGTEXT NULL',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hrm_interview_candidate'
    AND COLUMN_NAME = 'attachments'
);
PREPARE stmt FROM @add_attachments;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
