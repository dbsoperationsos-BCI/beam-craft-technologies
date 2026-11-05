-- Which department a task belongs to and which branch it is for.
--
-- A task said who it was for and what kind of work it was, but not where in the studio it sat, so a
-- list of tasks could not be read by branch or by department at all - the two questions a manager
-- reading the whole studio's list actually asks.
--
-- The task's own answer rather than the assignee's, because work crosses those lines regularly:
-- Erode's editor finishing a Karim Nagar wedding is a Karim Nagar task done by an Erode person, and
-- reading it off the person would file it under the wrong branch. Names rather than ids, the way
-- every table but `user` and `asset` stores its branch.
--
-- Nullable with no backfill: the tasks raised before this was asked for genuinely have no answer,
-- and guessing one from the assignee would state as fact something nobody chose. The form requires
-- both from here on, so only the existing rows read blank.
ALTER TABLE `hrm_task`
  ADD COLUMN `department` VARCHAR(120) NULL,
  ADD COLUMN `branch` VARCHAR(120) NULL;
