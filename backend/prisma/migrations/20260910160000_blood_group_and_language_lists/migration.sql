-- The last two employee dropdowns the studio could not maintain: Blood Group and Languages Known.
--
-- `20260910120000_employee_option_lists` took six of the employee form's lists out of the browser
-- and put them in tables Settings -> Field Settings can edit. These two were left behind, and they
-- were left behind in different states.
--
-- Blood Group had no table at all - eight values compiled into `frontend/src/constants/employeeOptions.js`
-- and nowhere else - so `blood_group` is created here and seeded with exactly those eight.
--
-- Languages already had a table. `language` has existed, and has a master-data definition and
-- routes, since the HRM foundation; nothing ever wrote a row to it and no screen ever offered it,
-- so the employee form went on reading the seventeen languages compiled into the browser. Only the
-- seed was missing, which is what this adds.
--
-- The rows below are exactly what the browser offered, so nothing an employee has already answered
-- stops matching a list. Both seeds insert only into an empty table, so a studio that has already
-- added its own languages keeps them.
--
-- Written by hand and applied with `prisma migrate deploy`; index names stay well inside MySQL's
-- 64-character limit.

CREATE TABLE `blood_group` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `blood_group_code_key`(`code`),
  INDEX `blood_group_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The column the list fills. Ten characters was sized for "AB+" and nothing else; a maintained list
-- accepts a name of up to 120, so an entry like "AB Positive" would have been silently cut to
-- eleven characters or refused on save. Fifty, the width `marital_status` beside it uses. Widening
-- keeps every value already stored.
ALTER TABLE `employee` MODIFY `blood_group` VARCHAR(50) NULL;

-- The eight the browser offered, in the order it offered them. `sort_order` is not a column on this
-- list - it reads alphabetically, like the other plain lists - and A-/A+ through O-/O+ reads the
-- same either way.
INSERT INTO `blood_group` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'A_POSITIVE' AS `code`, 'A+' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'A_NEGATIVE', 'A-', NOW(3)
  UNION ALL SELECT 'B_POSITIVE', 'B+', NOW(3)
  UNION ALL SELECT 'B_NEGATIVE', 'B-', NOW(3)
  UNION ALL SELECT 'AB_POSITIVE', 'AB+', NOW(3)
  UNION ALL SELECT 'AB_NEGATIVE', 'AB-', NOW(3)
  UNION ALL SELECT 'O_POSITIVE', 'O+', NOW(3)
  UNION ALL SELECT 'O_NEGATIVE', 'O-', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `blood_group` `existing`);

-- The seventeen the browser offered. The table is old and empty; this is the first thing to put a
-- row in it.
INSERT INTO `language` (`code`, `name`, `updated_at`)
SELECT * FROM (
  SELECT 'ENGLISH' AS `code`, 'English' AS `name`, NOW(3) AS `updated_at`
  UNION ALL SELECT 'TAMIL', 'Tamil', NOW(3)
  UNION ALL SELECT 'TELUGU', 'Telugu', NOW(3)
  UNION ALL SELECT 'KANNADA', 'Kannada', NOW(3)
  UNION ALL SELECT 'MALAYALAM', 'Malayalam', NOW(3)
  UNION ALL SELECT 'HINDI', 'Hindi', NOW(3)
  UNION ALL SELECT 'MARATHI', 'Marathi', NOW(3)
  UNION ALL SELECT 'BENGALI', 'Bengali', NOW(3)
  UNION ALL SELECT 'GUJARATI', 'Gujarati', NOW(3)
  UNION ALL SELECT 'PUNJABI', 'Punjabi', NOW(3)
  UNION ALL SELECT 'URDU', 'Urdu', NOW(3)
  UNION ALL SELECT 'ODIA', 'Odia', NOW(3)
  UNION ALL SELECT 'ASSAMESE', 'Assamese', NOW(3)
  UNION ALL SELECT 'SANSKRIT', 'Sanskrit', NOW(3)
  UNION ALL SELECT 'KONKANI', 'Konkani', NOW(3)
  UNION ALL SELECT 'MANIPURI', 'Manipuri', NOW(3)
  UNION ALL SELECT 'NEPALI', 'Nepali', NOW(3)
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `language` `existing`);
