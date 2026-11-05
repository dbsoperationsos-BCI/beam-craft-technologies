-- Project Management → Feedback: where each feedback has got to, for the status bar above the table
-- (Yet to be done, Issues, Issues sorted, Completed, Rejected - the list is the feedback service's).
--
-- Every feedback already given starts as Yet to be done, which is what the column's default writes
-- into the existing rows. No permission: the status is read under PROJECT / Feedback, as the rest
-- of the row is.
--
-- Cost: one column with a constant default on a small table. Instant.
ALTER TABLE `project_feedback` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'Yet to be done';
