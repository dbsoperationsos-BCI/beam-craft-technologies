-- The ten numbered increment columns, and their ten dates, go.
--
-- They were a fixed twenty slots on `employee` that could only ever hold ten raises, and they were
-- replaced by `employee_review` - one row per salary review, with the employee's totals, last
-- review date and next review date derived from those rows. Nothing has written to these since;
-- the repository table listed them as twenty empty columns and the employee form carried them
-- through a save untouched, which is the whole of what they still did.
--
-- ── Read this before deploying ──
--
-- This is a DROP, and a dropped column takes its data with it. It was verified empty on every row
-- of one database before this was written; **check yours before `migrate deploy`**, with
--
--   SELECT COUNT(*) FROM `employee`
--    WHERE `increment_01` IS NOT NULL OR `increment_01_date` IS NOT NULL
--       OR `increment_02` IS NOT NULL OR `increment_02_date` IS NOT NULL
--       OR `increment_03` IS NOT NULL OR `increment_03_date` IS NOT NULL
--       OR `increment_04` IS NOT NULL OR `increment_04_date` IS NOT NULL
--       OR `increment_05` IS NOT NULL OR `increment_05_date` IS NOT NULL
--       OR `increment_06` IS NOT NULL OR `increment_06_date` IS NOT NULL
--       OR `increment_07` IS NOT NULL OR `increment_07_date` IS NOT NULL
--       OR `increment_08` IS NOT NULL OR `increment_08_date` IS NOT NULL
--       OR `increment_09` IS NOT NULL OR `increment_09_date` IS NOT NULL
--       OR `increment_10` IS NOT NULL OR `increment_10_date` IS NOT NULL;
--
-- Anything other than 0 is a raise recorded nowhere else, and it should be written into
-- `employee_review` before this runs.
--
-- Plain `DROP COLUMN`, with no `IF EXISTS`: that is MariaDB syntax and MySQL 8 rejects it. Prisma
-- records the migration as applied, so this runs once per database and does not need to be
-- re-runnable; a database where somebody has already dropped one of these by hand needs the
-- migration resolved by hand too.

ALTER TABLE `employee`
  DROP COLUMN `increment_01`,
  DROP COLUMN `increment_01_date`,
  DROP COLUMN `increment_02`,
  DROP COLUMN `increment_02_date`,
  DROP COLUMN `increment_03`,
  DROP COLUMN `increment_03_date`,
  DROP COLUMN `increment_04`,
  DROP COLUMN `increment_04_date`,
  DROP COLUMN `increment_05`,
  DROP COLUMN `increment_05_date`,
  DROP COLUMN `increment_06`,
  DROP COLUMN `increment_06_date`,
  DROP COLUMN `increment_07`,
  DROP COLUMN `increment_07_date`,
  DROP COLUMN `increment_08`,
  DROP COLUMN `increment_08_date`,
  DROP COLUMN `increment_09`,
  DROP COLUMN `increment_09_date`,
  DROP COLUMN `increment_10`,
  DROP COLUMN `increment_10_date`;
