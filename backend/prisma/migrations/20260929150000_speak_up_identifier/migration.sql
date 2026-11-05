-- The code a Speak-up is read by, on Speak-up Review: `DBS-SPK-00001`.
--
-- Every other register in the studio hands its records a code somebody can quote, and Speak-up had
-- only the row's own database id. One run of numbers for the whole studio: a Speak-up is confidential
-- to HR and belongs to neither a vertical nor a branch. Five digits, not six - the width HR asked for.
--
-- Nullable because the rows are already here (`scripts/renumberIdentifiers.js --only=SPEAK_UP
-- --apply` fills them in, oldest first, and leaves the counter where the live path carries on
-- from); a row that somehow still has none is given the next code the next time it is saved.
-- Unique either way - MySQL allows many NULLs in a unique index, which is what lets the column be
-- added before it is filled.
ALTER TABLE `speak_up`
  ADD COLUMN `speak_up_id` VARCHAR(30) NULL,
  ADD UNIQUE INDEX `speak_up_speak_up_id_key` (`speak_up_id`);
