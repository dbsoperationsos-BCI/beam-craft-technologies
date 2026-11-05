-- The three repeating lists an employee record carries: their children, what they studied, and
-- where they have worked. All three are tables rather than columns on `employee`, for the reason
-- `employee_review` is one — each row is several facts that only mean anything together, and there
-- is no fixed number of them. All three cascade, because a row is a fact *about* an employee record
-- and means nothing without one.

-- A married employee's children, one row each.
CREATE TABLE `employee_child` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  -- Nullable so a row can never be the reason a submission is refused, though both forms ask for it
  -- and refuse a half-filled row of their own accord.
  `date_of_birth` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Always read as "this employee's children", never on their own.
  INDEX `employee_child_employee_id_idx` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the employee studied: a school, a diploma, a degree — one row each.
--
-- Everything but the degree is nullable: a school year has no branch, and somebody part way through
-- a course has no passing year yet. The year is stored alone rather than as a date, because nobody
-- knows the day they passed out and a year is what a résumé and a verification call actually use.
CREATE TABLE `employee_qualification` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `degree` VARCHAR(150) NOT NULL,
  `branch` VARCHAR(150) NULL,
  `college` VARCHAR(200) NULL,
  `passed_out_year` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Always read as "this employee's qualifications", never on their own.
  INDEX `employee_qualification_employee_id_idx` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The jobs held before this one, with the letter that evidences each.
--
-- Only the company is required: an old job whose exact length nobody remembers is still worth
-- recording, and refusing it here would be the reason somebody could not finish their onboarding.
-- `attachment_url` is a MEDIUMTEXT for the reason the resignation letter's is — it holds the link
-- the file was uploaded to, or the inline document itself where object storage is not configured.
CREATE TABLE `employee_experience` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `company_name` VARCHAR(200) NOT NULL,
  `company_location` VARCHAR(200) NULL,
  `role` VARCHAR(150) NULL,
  -- Years to one decimal — "2.5" is how a résumé says it — rather than two dates, which is a
  -- granularity nobody actually remembers for a job they left years ago.
  `years` DECIMAL(4, 1) NULL,
  `attachment_name` VARCHAR(255) NULL,
  `attachment_url` MEDIUMTEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Always read as "this employee's experience", never on its own.
  INDEX `employee_experience_employee_id_idx` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `employee_child`
  ADD CONSTRAINT `employee_child_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_qualification`
  ADD CONSTRAINT `employee_qualification_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_experience`
  ADD CONSTRAINT `employee_experience_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
