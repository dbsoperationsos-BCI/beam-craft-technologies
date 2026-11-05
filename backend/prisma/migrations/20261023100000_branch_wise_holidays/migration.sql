-- Branch-wise holidays.
--
-- A holiday used to be the studio's: one row per day, read by every employee's calendar and every
-- attendance calculation alike. A studio with branches in different towns closes them on different
-- days, so a holiday now says which branches it is for.
--
-- `attendance_holiday_branch` lists them. A holiday with **no rows here is for every branch** - which
-- is every holiday declared before this, so nothing already declared changes meaning and no row is
-- rewritten. Unique per (holiday, branch), so a branch is never listed twice against one holiday;
-- both links cascade, so removing a holiday or a branch takes its links with it and nothing dangles.
--
-- The one-holiday-per-day unique index goes: two branches may each have their own holiday on one
-- day. What may still not happen - two holidays for the same branch on one day, or a studio-wide one
-- beside a branch's - the holidays controller refuses before writing. The plain index on the day
-- stays for the range reads.
--
-- Reversible on the day it is applied: drop `attendance_holiday_branch` and re-add the unique index.
-- Once two branches have each declared a holiday on one day that re-add fails, so a later rollback
-- first merges or removes the same-day holidays - a decision for the studio, not a script.
--
-- Cost: one index dropped and one empty table created. Instant; no row is read or written.

ALTER TABLE `attendance_holiday` DROP INDEX `attendance_holiday_holiday_date_key`;

CREATE TABLE `attendance_holiday_branch` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `holiday_id` INTEGER NOT NULL,
  `branch_id` INTEGER NOT NULL,

  UNIQUE INDEX `attendance_holiday_branch_holiday_id_branch_id_key`(`holiday_id`, `branch_id`),
  INDEX `attendance_holiday_branch_branch_id_idx`(`branch_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_holiday_branch`
  ADD CONSTRAINT `attendance_holiday_branch_holiday_id_fkey` FOREIGN KEY (`holiday_id`) REFERENCES `attendance_holiday`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance_holiday_branch`
  ADD CONSTRAINT `attendance_holiday_branch_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
