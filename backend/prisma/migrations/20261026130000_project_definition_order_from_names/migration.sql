-- Services and deliverables start in the order they are listed in today: by name.
--
-- Settings -> Project -> Services and Deliverables can now be put in order by dragging, and every
-- list of them reads `sort_order` first. Until now nothing read it - every list was alphabetical -
-- and it held the order the rows were made in, so switching the lists over would have reshuffled
-- every catalogue the moment this shipped. Numbering each table by name, once, here, means nothing
-- moves until somebody drags it.
--
-- Data only: no column, key or index changes. Retired rows are numbered too, so one brought back
-- has a place among the rest. Ties cannot happen - `name` is unique - but `id` settles them anyway.
-- Cost: one pass over each table, tens of rows.

UPDATE `project_service_definition` AS `target`
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (ORDER BY `name`, `id`) - 1 AS `position`
  FROM `project_service_definition`
) AS `ranked` ON `ranked`.`id` = `target`.`id`
SET `target`.`sort_order` = `ranked`.`position`;

UPDATE `project_deliverable_definition` AS `target`
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (ORDER BY `name`, `id`) - 1 AS `position`
  FROM `project_deliverable_definition`
) AS `ranked` ON `ranked`.`id` = `target`.`id`
SET `target`.`sort_order` = `ranked`.`position`;
