-- Incorrect Login and Correction.
--
-- A login is an open session for 24 hours from the latest login and no longer (`last_login_at`; a
-- row without one counts from `login_at`). A Correction request carries the day's status as the
-- server read it and the status asked for, and an approved one writes the day's status into
-- `attendance_status_override` - one row per person per day, with or without a login behind it.
-- Additive only: three nullable columns and one new table; no existing row is rewritten.
ALTER TABLE `attendance_session`
  ADD COLUMN `last_login_at` DATETIME(3) NULL;

ALTER TABLE `attendance_request`
  ADD COLUMN `current_status` VARCHAR(30) NULL,
  ADD COLUMN `requested_status` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `attendance_status_override` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `work_date` DATE NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `request_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_status_override_employee_id_work_date_key`(`employee_id`, `work_date`),
    INDEX `attendance_status_override_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendance_status_override` ADD CONSTRAINT `attendance_status_override_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `attendance_status_override` ADD CONSTRAINT `attendance_status_override_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `attendance_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
