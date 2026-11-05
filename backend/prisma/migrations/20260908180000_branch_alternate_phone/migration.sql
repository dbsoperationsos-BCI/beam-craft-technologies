-- A second phone number for a branch.
--
-- One number was never quite enough: a branch answers on a landline as well as a mobile, or the
-- person who answers the first is not always the one to reach. The column sits beside `phone` and
-- means the same kind of thing, so it takes the same width the first one took.
--
-- Nullable, like every other detail on a branch: a branch exists on its name alone, and the rest is
-- filled in as it becomes known.
ALTER TABLE `branch`
  ADD COLUMN `alternate_phone` VARCHAR(20) NULL AFTER `phone`;
