-- Settings -> Field Settings -> Human Resource Management could maintain four of the employee
-- form's lists - designations, departments, verticals, skills - and the rest were arrays written
-- into the browser: gender, marital status, work type, emergency contact relationship, the work
-- locations and the employee statuses. A studio could not add a work location or retire a status.
--
-- Two of the six already had a table (`work_type`, `employee_status`); both were empty, because
-- nothing ever wrote to them. Four did not, and are created here.
--
-- The two flags are the point of the change rather than a detail of it. `counts_as_working` and
-- `requires_spouse_details` carry the meaning the code used to read out of the words themselves -
-- the array ["Active", "in Training", "PIP"] repeated in four files, and the literal "Married"
-- checked in four more. Editing a list whose meaning is hard-coded elsewhere is how a rename
-- silently stops a form asking for a spouse, or drops somebody off the list of people who may be
-- handed an asset. With the meaning on the row, the list can be edited and the behaviour follows.
--
-- The rows below are exactly what the browser offered before this, so nothing an employee already
-- answered stops matching. Written by hand and applied with `prisma migrate deploy`; index names
-- are kept well inside MySQL's 64-character limit.

CREATE TABLE `marital_status` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `requires_spouse_details` BOOLEAN NOT NULL DEFAULT false,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `marital_status_code_key`(`code`),
  INDEX `marital_status_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `emergency_contact_relationship` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `emergency_contact_rel_code_key`(`code`),
  INDEX `emergency_contact_rel_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_location` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `work_location_code_key`(`code`),
  INDEX `work_location_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `gender` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `gender_code_key`(`code`),
  INDEX `gender_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The meaning, moved out of the code and onto the row it belongs to.
ALTER TABLE `employee_status` ADD COLUMN `counts_as_working` BOOLEAN NOT NULL DEFAULT false;

-- The lists as the browser held them, so a record already answered keeps matching. Each is
-- inserted only while its table is still empty, so re-running this cannot duplicate a studio's
-- own edits or undo a deletion they meant.
INSERT INTO `marital_status` (`code`, `name`, `requires_spouse_details`, `updated_at`)
SELECT * FROM (
  SELECT 'SINGLE' AS `code`, 'Single' AS `name`, false AS `requires_spouse_details`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'MARRIED', 'Married', true, NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', false, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `marital_status` `existing`);

INSERT INTO `gender` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'MALE' AS `code`, 'Male' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'FEMALE', 'Female', NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `gender` `existing`);

INSERT INTO `emergency_contact_relationship` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'FATHER' AS `code`, 'Father' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'MOTHER', 'Mother', NOW(3)
  UNION ALL SELECT 'SPOUSE', 'Spouse', NOW(3)
  UNION ALL SELECT 'BROTHER', 'Brother', NOW(3)
  UNION ALL SELECT 'SISTER', 'Sister', NOW(3)
  UNION ALL SELECT 'SON', 'Son', NOW(3)
  UNION ALL SELECT 'DAUGHTER', 'Daughter', NOW(3)
  UNION ALL SELECT 'GUARDIAN', 'Guardian', NOW(3)
  UNION ALL SELECT 'FRIEND', 'Friend', NOW(3)
  UNION ALL SELECT 'RELATIVE', 'Relative', NOW(3)
  UNION ALL SELECT 'OTHER', 'Other', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `emergency_contact_relationship` `existing`);

INSERT INTO `work_location` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'ERODE_TN' AS `code`, 'Erode TN' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'TIRUPPUR_TN', 'Tiruppur TN', NOW(3)
  UNION ALL SELECT 'COIMBATORE_TN', 'Coimbatore TN', NOW(3)
  UNION ALL SELECT 'BANGALORE_KA', 'Bangalore KA', NOW(3)
  UNION ALL SELECT 'HYDERABAD_TL', 'Hyderabad TL', NOW(3)
  UNION ALL SELECT 'VISAKHAPATNAM_AP', 'Visakhapatnam AP', NOW(3)
  UNION ALL SELECT 'REMOTE', 'Remote', NOW(3)
  UNION ALL SELECT 'WORK_FROM_HOME', 'Work From Home', NOW(3)
  UNION ALL SELECT 'ON_FIELD', 'On Field', NOW(3)
  UNION ALL SELECT 'OTHERS', 'Others', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `work_location` `existing`);

INSERT INTO `work_type` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'FULL_TIME' AS `code`, 'Full Time' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'PART_TIME', 'Part Time', NOW(3)
  UNION ALL SELECT 'TRAINEE', 'Trainee', NOW(3)
  UNION ALL SELECT 'INTERN', 'Intern', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `work_type` `existing`);

-- `counts_as_working` reproduces the array the code carried: Active, in Training and PIP are the
-- three an employee could be handed an asset on, be listed as a CRM on, or link WhatsApp on.
INSERT INTO `employee_status` (`code`, `name`, `counts_as_working`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'ACTIVE' AS `code`, 'Active' AS `name`, true AS `counts_as_working`, 0 AS `sort_order`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'IN_TRAINING', 'in Training', true, 1, NOW(3)
  UNION ALL SELECT 'PIP', 'PIP', true, 2, NOW(3)
  UNION ALL SELECT 'ONBOARD_PENDING', 'Onboard Pending', false, 3, NOW(3)
  UNION ALL SELECT 'NOTICE_PERIOD', 'Notice Period', false, 4, NOW(3)
  UNION ALL SELECT 'RESIGNED', 'Resigned', false, 5, NOW(3)
  UNION ALL SELECT 'TERMINATED', 'Terminated', false, 6, NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `employee_status` `existing`);
