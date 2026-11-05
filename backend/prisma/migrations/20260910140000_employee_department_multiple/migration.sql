-- Department becomes several departments.
--
-- It was one `VARCHAR(150)` holding one name. The employee form now asks for it the way it asks
-- for Skills and Languages Known - a searchable multi-select - and those are stored as the chosen
-- values joined by ", ", which is why both of them are `TEXT`. Fifteen departments joined run to
-- 188 characters, so the old column would have refused a wide enough answer partway through and
-- the save would have failed on something the form had offered.
--
-- Nothing is lost or rewritten: a single department already stored is a one-item list and reads
-- back as itself. Nothing filters or joins on this column, so widening it changes no query.

ALTER TABLE `employee` MODIFY COLUMN `department` TEXT NULL;
