-- Employee Attendance: breaks inside a logged-in day.
--
-- Break In and Break Off from the Employee Attendance header, on the server's clock like the login
-- and logout, several a day. A break still open at logout is closed at the logout time. Recorded and
-- summarised only - the hours worked are still check-in to check-out, so no attendance status
-- already decided changes because this table exists.

CREATE TABLE `attendance_break` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_id` INTEGER NOT NULL,
  `employee_id` INTEGER NOT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `attendance_break_session_id_started_at_idx`(`session_id`, `started_at`),
  INDEX `attendance_break_employee_id_ended_at_idx`(`employee_id`, `ended_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_break` ADD CONSTRAINT `attendance_break_session_id_fkey`
  FOREIGN KEY (`session_id`) REFERENCES `attendance_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
