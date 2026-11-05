-- An employee's branch as a reference, beside the two free-text columns that held it.
--
-- `employee` kept its branch as text in `work_base_location` and `current_work_location`, which
-- is why the assistant's HRM tools have been throwing for everyone but a Super Admin: the read
-- service narrows employees by `branchId`, `Employee` had no such column, and Prisma refused the
-- query. A Super Admin's branch list is null, so the filter was never built and the fault never
-- showed on the one path anybody tried.
--
-- The fix the brief asked for is the real column. Nullable, indexed, FOREIGN KEY to `branch(id)`,
-- SET NULL when a branch is retired so its people stay readable. Nothing is backfilled: the four
-- employees on record have no work location at all, and the rule for matching text to branches is
-- decided from the match report (DATA-SCOPE.md, Stage 6), not here. Until then the read service
-- honours the id where it is set and falls back to the text where it is not.
--
-- Cost: adding a nullable column is a metadata change in InnoDB; the index and the key are built
-- online against a column that is NULL in every row. Seconds at any size.

ALTER TABLE `employee` ADD COLUMN `branch_id` INT NULL AFTER `current_work_location`;
CREATE INDEX `employee_branch_id_idx` ON `employee` (`branch_id`);
ALTER TABLE `employee`
  ADD CONSTRAINT `employee_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
