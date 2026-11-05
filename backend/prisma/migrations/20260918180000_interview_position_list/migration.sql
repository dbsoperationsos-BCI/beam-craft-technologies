-- The positions the Interview register offers beyond the studio's designation list.
--
-- Position Applied For reads the designations, and should: most applications are for a role the
-- studio actually has, and that list is already maintained in Settings. What it could not offer is
-- a position nobody is ever *employed* as - "General", the answer to a hiring ad that names no role.
--
-- Putting "General" into `designation` would have been the short way and the wrong one: it would
-- then appear in every employee's designation picker, on an employee record, on a payslip, in the
-- Employee Repository's filters. No employee's designation is General. The question "what did this
-- person apply for" and the question "what is this person's designation" have different answers, so
-- they get different lists, and the options endpoint merges them - designations first, this list
-- after, deduplicated.
--
-- A studio wanting more of them - "Any Role", "Internship", a season's intake - adds rows in
-- Settings → Fields → Interview → Positions rather than waiting for a release, which is the same
-- reason Sources stopped being a hardcoded array.
--
-- `prisma/seeds/interview-positions.seed.js` holds the same row for a developer's machine and is the
-- file to keep this in step with; this migration is what reaches production, where the seed cannot
-- be run (CLAUDE.md). Both fill only what is missing: `WHERE NOT EXISTS` against the whole table, so
-- a re-run writes nothing and a studio's own edits are never talked back.
--
-- No permission changes: the list is read by `/api/hrm/interview/options`, which answers to
-- `HRM / Interview`, and maintained through Settings → Fields, which answers to its own.
--
-- Cost: one table and one row. Instant.

CREATE TABLE `interview_position` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `interview_position_code_key`(`code`),
    INDEX `interview_position_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `interview_position` (`code`, `name`, `sort_order`, `updated_at`)
SELECT * FROM (
  SELECT 'GENERAL' AS `code`, 'General' AS `name`, 10 AS `sort_order`, NOW(3) AS `updated_at`
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM `interview_position` `existing`);
