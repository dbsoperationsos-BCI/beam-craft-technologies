-- A branch and an employee remember the names they used to have.
--
-- Renaming in Settings rewrites every stored copy of the name (services/nameCopies.js), but it cannot
-- reach a Google Sheet or a CSV that still says the old one. On the next sync that cell matched no
-- branch, so the lead was written back with the old text and no branch link - and a rename undid
-- itself one sync at a time. The former names now live on the row, as a list, and the matcher
-- resolves them to it: the stale cell lands on the right branch and is rewritten to the current
-- spelling. The same for an employee's former full names and the CRM column.
--
-- The list also takes the studio's own spellings. "Tirupur" - one p - is how six leads on the
-- studio's data write Tiruppur, so it is taught here; it is a spelling, not another branch.

ALTER TABLE `branch` ADD COLUMN `aliases` JSON NULL;
ALTER TABLE `employee` ADD COLUMN `aliases` JSON NULL;

UPDATE `branch` SET `aliases` = JSON_ARRAY('Tirupur') WHERE `code` = 'TIRUPPUR_TN' AND `aliases` IS NULL;
