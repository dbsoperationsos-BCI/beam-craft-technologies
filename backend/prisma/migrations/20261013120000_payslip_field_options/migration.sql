-- Edit Payslip's Dropdown input type: an added Personal or PF detail answered by choosing one of the
-- options typed when it was added (`["A+", "B+", ...]`). Null for every other input type.

ALTER TABLE `payslip_field` ADD COLUMN `options` JSON NULL;
