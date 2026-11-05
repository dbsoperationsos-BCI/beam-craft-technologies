-- The line an employee reads after marking their day.
--
-- A table rather than a constant so the studio can change these without a deploy, and three per
-- weekday rather than one because the same sentence every Monday stops being read by the second
-- week. Which one shows is worked out from the date, so everybody sees the same line on the same
-- day and it does not change when somebody reloads.
--
-- Seeded here rather than in `prisma/seed.js` because these are content, not structure: a studio
-- that rewrites all twenty-one should not have them put back by the next reseed. Written by hand
-- and applied with `prisma migrate deploy`.

CREATE TABLE `attendance_quote` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  -- `Date.getDay()`: 0 is Sunday.
  `day_of_week` INTEGER NOT NULL,
  `quote` VARCHAR(400) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `attendance_quote_day_active_idx`(`day_of_week`, `is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `attendance_quote` (`day_of_week`, `quote`, `is_active`, `updated_at`) VALUES
  (0, 'Rest, reset and prepare for what comes next.', true, CURRENT_TIMESTAMP(3)),
  (0, 'A quiet day is still part of the work.', true, CURRENT_TIMESTAMP(3)),
  (0, 'Step back today so you can see further tomorrow.', true, CURRENT_TIMESTAMP(3)),
  (1, 'Start the week with purpose, not pressure.', true, CURRENT_TIMESTAMP(3)),
  (1, 'The first hour of Monday sets the other thirty-nine.', true, CURRENT_TIMESTAMP(3)),
  (1, 'Begin with the thing you are avoiding.', true, CURRENT_TIMESTAMP(3)),
  (2, 'Consistency turns good work into great work.', true, CURRENT_TIMESTAMP(3)),
  (2, 'Tuesday is where the week is actually decided.', true, CURRENT_TIMESTAMP(3)),
  (2, 'Do it again, a little better than yesterday.', true, CURRENT_TIMESTAMP(3)),
  (3, 'Halfway there. Keep the momentum moving.', true, CURRENT_TIMESTAMP(3)),
  (3, 'Wednesday rewards whoever kept going on Tuesday.', true, CURRENT_TIMESTAMP(3)),
  (3, 'Check the plan still matches the work.', true, CURRENT_TIMESTAMP(3)),
  (4, 'Progress matters more than perfection.', true, CURRENT_TIMESTAMP(3)),
  (4, 'Finish something today rather than starting three things.', true, CURRENT_TIMESTAMP(3)),
  (4, 'Almost done is not done. Close one thing out.', true, CURRENT_TIMESTAMP(3)),
  (5, 'Finish the week stronger than you started.', true, CURRENT_TIMESTAMP(3)),
  (5, 'Leave Monday something tidy to walk into.', true, CURRENT_TIMESTAMP(3)),
  (5, 'Hand it over clearly, then put it down.', true, CURRENT_TIMESTAMP(3)),
  (6, 'Small progress today creates bigger results tomorrow.', true, CURRENT_TIMESTAMP(3)),
  (6, 'A short focused Saturday beats a long distracted one.', true, CURRENT_TIMESTAMP(3)),
  (6, 'Wrap the loose ends while they are still fresh.', true, CURRENT_TIMESTAMP(3));
