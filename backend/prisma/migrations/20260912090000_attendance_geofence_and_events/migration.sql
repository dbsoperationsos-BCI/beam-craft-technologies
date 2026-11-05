-- Attendance, phase 1: where somebody was, and an audit trail that cannot be overwritten.
--
-- Three things the module could not do. It recorded GPS on every login and then never compared it
-- to anything, because no branch knew where its office was. It kept the day as one mutable row, so
-- a correction by HR would silently replace what the employee actually submitted. And the selfie
-- was written to the same public bucket as every other image in the application, which is the wrong
-- home for a photograph of a named person at a place and a time.
--
-- `attendance_office_location` is its own table rather than two columns on `branch`: a branch is an
-- accounting and addressing concept half this schema points at, and a circle on a map is an
-- attendance rule only this module reads. A branch with no row here has no geofence, which is the
-- honest state of every branch the day this ships.
--
-- `attendance_event` is append-only. Every column on `attendance_session` that this migration adds
-- is the *current* reading of the day; the event rows are what was actually captured, and nothing
-- updates or deletes them.
--
-- Every new column on the two existing tables is nullable or carries a default, so the rows already
-- in them stay valid and every existing query keeps working. Written by hand and applied with
-- `prisma migrate deploy`; index names stay inside MySQL's 64-character limit.


-- The office a branch is measured from.
CREATE TABLE `attendance_office_location` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `branch_id` INTEGER NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `latitude` DECIMAL(10, 7) NOT NULL,
  `longitude` DECIMAL(10, 7) NOT NULL,
  -- NULL falls back to the studio-wide default below, so a branch that has never thought about its
  -- radius still has a circle.
  `allowed_radius_meters` INTEGER NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by_id` INTEGER NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `attendance_office_location_branch_id_key`(`branch_id`),
  INDEX `attendance_office_location_is_active_idx`(`is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Deleting a branch takes its office with it: a circle around a branch that no longer exists is
-- not a rule anybody can be judged by.
ALTER TABLE `attendance_office_location`
  ADD CONSTRAINT `attendance_office_location_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Every capture, exactly as it happened. Never updated, never deleted.
CREATE TABLE `attendance_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `session_id` INTEGER NOT NULL,
  `employee_id` INTEGER NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `captured_at` DATETIME(3) NOT NULL,
  `selfie_key` VARCHAR(255) NULL,
  `selfie_data` MEDIUMTEXT NULL,
  `face_verified` BOOLEAN NOT NULL DEFAULT false,
  `latitude` DECIMAL(10, 7) NULL,
  `longitude` DECIMAL(10, 7) NULL,
  `accuracy_m` INTEGER NULL,
  `branch_id` INTEGER NULL,
  `distance_meters` INTEGER NULL,
  `location_verified` BOOLEAN NOT NULL DEFAULT false,
  `location_note` VARCHAR(255) NULL,
  `device_info` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `attendance_event_session_captured_idx`(`session_id`, `captured_at`),
  INDEX `attendance_event_employee_captured_idx`(`employee_id`, `captured_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_event`
  ADD CONSTRAINT `attendance_event_session_id_fkey`
  FOREIGN KEY (`session_id`) REFERENCES `attendance_session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- The geofence's own rules, alongside the shift they sit with.
ALTER TABLE `attendance_settings`
  ADD COLUMN `default_radius_meters` INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN `max_gps_accuracy_meters` INTEGER NOT NULL DEFAULT 150,
  -- Off by default, so shipping the geofence cannot lock anybody out of marking their day on the
  -- morning it lands. Turning it on is a decision the studio makes once offices are recorded.
  ADD COLUMN `enforce_geofence` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `half_day_minutes` INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN `early_exit_grace_minutes` INTEGER NOT NULL DEFAULT 15;


-- What the day currently reads as, per end of it. `login_selfie_url` is deliberately left alone:
-- rows already hold links in it, and it stays the fallback for a server with no object storage.
ALTER TABLE `attendance_session`
  ADD COLUMN `login_selfie_key` VARCHAR(255) NULL,
  ADD COLUMN `logout_selfie_key` VARCHAR(255) NULL,
  ADD COLUMN `logout_face_verified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `login_branch_id` INTEGER NULL,
  ADD COLUMN `login_distance_meters` INTEGER NULL,
  ADD COLUMN `login_location_verified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `logout_branch_id` INTEGER NULL,
  ADD COLUMN `logout_distance_meters` INTEGER NULL,
  ADD COLUMN `logout_location_verified` BOOLEAN NOT NULL DEFAULT false;
