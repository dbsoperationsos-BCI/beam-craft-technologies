-- Who each employee reports to, which is what the organisation chart is drawn from.
--
-- One manager per employee, not a list: a single parent is what makes the reporting map a tree that
-- can be walked upward to a root, rather than a graph with no top to arrive at.
--
-- Nullable, and no backfill. Nobody has a reporting person recorded yet, so every row starts as a
-- root of the chart and the studio fills the relationships in from the employee form. An employee
-- left empty is not an error state — the founder legitimately reports to nobody.
--
-- ON DELETE SET NULL rather than RESTRICT, matching the alternative-cover columns beside it:
-- removing a manager must leave their reports without one rather than refuse the deletion and
-- block an offboarding. Those reports then show as roots until they are pointed at somebody else.
ALTER TABLE `employee` ADD COLUMN `reports_to_employee_id` INTEGER NULL;

-- Drawing the chart asks "everyone reporting to this person" once per node, which is this index.
CREATE INDEX `employee_reports_to_employee_id_idx` ON `employee`(`reports_to_employee_id`);

ALTER TABLE `employee`
  ADD CONSTRAINT `employee_reports_to_employee_id_fkey`
  FOREIGN KEY (`reports_to_employee_id`) REFERENCES `employee`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
