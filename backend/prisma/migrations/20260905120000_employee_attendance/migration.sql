-- One person's attendance for one day.
--
-- Attendance is *derived* from `app_usage_session` by default - that table already measures when
-- somebody was working and for how long, which is most of attendance. This is what overrides it: a
-- day with no row here reads as whatever the person's own activity says, and a day with one reads as
-- what somebody wrote down. So nothing has to be entered for the ordinary case, and leave, a public
-- holiday, a half day or a day spent on a shoot with no laptop open can still be recorded.
--
-- The unique key is the whole integrity of the table: attendance answers one question per day, and
-- two rows for one day would be two answers with no rule for which wins.
CREATE TABLE `employee_attendance` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  -- A date, not a moment: a day is the unit attendance is kept in, and a timestamp would make
  -- "the 5th" depend on the timezone it was read in.
  `day` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PRESENT',
  `check_in_at` DATETIME(3) NULL,
  `check_out_at` DATETIME(3) NULL,
  `worked_minutes` INTEGER NULL,
  `note` TEXT NULL,
  `marked_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `employee_attendance_user_id_day_key` (`user_id`, `day`),
  -- The register reads a month for everybody and the calendar reads a range; both lead with the day.
  INDEX `employee_attendance_day_idx` (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cascading, because an attendance row is a fact *about* a login and means nothing without one.
-- Every other table that hangs off a person this way is left alone on delete because it is a record
-- of work done; this is a record of the person being there.
ALTER TABLE `employee_attendance`
  ADD CONSTRAINT `employee_attendance_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
