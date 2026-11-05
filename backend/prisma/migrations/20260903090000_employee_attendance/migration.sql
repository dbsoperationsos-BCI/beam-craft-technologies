-- Employee Attendance moves out of the browser.
--
-- Login, logout, leave, permission and on-duty were held in localStorage, which made every record
-- device-specific, erasable with the site data, and editable from the console by the person it
-- judged. These five tables are where they live now.

-- What a working day is, in one row: shift, grace, weekly offs, and the minutes a full day owes.
CREATE TABLE `attendance_settings` (
  `id` INT NOT NULL DEFAULT 1,
  `shift_start` VARCHAR(5) NOT NULL DEFAULT '09:30',
  `shift_end` VARCHAR(5) NOT NULL DEFAULT '18:30',
  `late_grace_minutes` INT NOT NULL DEFAULT 15,
  `daily_target_minutes` INT NOT NULL DEFAULT 510,
  `weekly_off_days` VARCHAR(20) NOT NULL DEFAULT '0',
  `max_permission_minutes` INT NOT NULL DEFAULT 180,
  `updated_by_id` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The defaults reproduce what the old screen had hardcoded — a 9:30 shift on time until 9:45 —
-- so nobody's attendance is re-judged by different numbers the moment this ships.
INSERT INTO `attendance_settings` (`id`, `updated_at`) VALUES (1, CURRENT_TIMESTAMP(3));

CREATE TABLE `attendance_holiday` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `holiday_date` DATE NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `created_by_id` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `attendance_holiday_holiday_date_key`(`holiday_date`),
  INDEX `attendance_holiday_holiday_date_idx`(`holiday_date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attendance_session` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `work_date` DATE NOT NULL,
  `login_at` DATETIME(3) NOT NULL,
  `logout_at` DATETIME(3) NULL,
  `work_mode` VARCHAR(30) NOT NULL DEFAULT 'office',
  `login_selfie_url` MEDIUMTEXT NULL,
  `login_face_verified` BOOLEAN NOT NULL DEFAULT false,
  `login_latitude` DECIMAL(10, 7) NULL,
  `login_longitude` DECIMAL(10, 7) NULL,
  `login_accuracy_m` INT NULL,
  `logout_latitude` DECIMAL(10, 7) NULL,
  `logout_longitude` DECIMAL(10, 7) NULL,
  `logout_accuracy_m` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  -- One login per person per day, enforced here rather than in a handler that can be raced.
  UNIQUE INDEX `attendance_session_employee_id_work_date_key`(`employee_id`, `work_date`),
  INDEX `attendance_session_work_date_idx`(`work_date`),
  INDEX `attendance_session_employee_id_login_at_idx`(`employee_id`, `login_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attendance_request` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `from_date` DATE NOT NULL,
  `to_date` DATE NOT NULL,
  `from_time` VARCHAR(5) NULL,
  `to_time` VARCHAR(5) NULL,
  `reason` TEXT NOT NULL,
  `supersedes_id` INT NULL,
  `decided_by_id` INT NULL,
  `decided_at` DATETIME(3) NULL,
  `decision_remarks` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `attendance_request_employee_id_status_idx`(`employee_id`, `status`),
  INDEX `attendance_request_type_status_idx`(`type`, `status`),
  INDEX `attendance_request_employee_id_from_date_to_date_idx`(`employee_id`, `from_date`, `to_date`),
  INDEX `attendance_request_supersedes_id_idx`(`supersedes_id`),
  INDEX `attendance_request_decided_by_id_idx`(`decided_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attendance_request_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `request_id` INT NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `actor_user_id` INT NULL,
  `actor_name` VARCHAR(150) NOT NULL,
  `remarks` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `attendance_request_event_request_id_created_at_idx`(`request_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_session`
  ADD CONSTRAINT `attendance_session_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance_request`
  ADD CONSTRAINT `attendance_request_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance_request`
  ADD CONSTRAINT `attendance_request_supersedes_id_fkey`
  FOREIGN KEY (`supersedes_id`) REFERENCES `attendance_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `attendance_request`
  ADD CONSTRAINT `attendance_request_decided_by_id_fkey`
  FOREIGN KEY (`decided_by_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `attendance_request_event`
  ADD CONSTRAINT `attendance_request_event_request_id_fkey`
  FOREIGN KEY (`request_id`) REFERENCES `attendance_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- An approver's queue asks "whose approver am I" across all three slots on every load.
CREATE INDEX `employee_leave_approver1_employee_id_idx` ON `employee`(`leave_approver1_employee_id`);
CREATE INDEX `employee_leave_approver2_employee_id_idx` ON `employee`(`leave_approver2_employee_id`);
CREATE INDEX `employee_leave_approver3_employee_id_idx` ON `employee`(`leave_approver3_employee_id`);
