-- Sale Extras: a row already deleted before the feature was installed is not part of the baseline.
--
-- 20261101160000_sale_extras gave every existing row a baseline snapshot - including rows that had
-- already been soft-deleted. Reconcile then read those as "removed after booking" and raised Removed
-- extras for deletions that happened before Sale Extras existed. This clears the snapshot on every row
-- deleted before that migration finished, and cancels the draft lines it caused (only drafts: nothing
-- was published from them, and a published line is never touched). Run in sequence with the first
-- migration, the result is the same everywhere: a project's baseline is its plan as it stood live.
--
-- Writes only `sale_baseline` on those rows and `status` on those draft lines. Instant.

UPDATE `project_sale_extra` AS `x`
  JOIN `project_shoot_deliverable` AS `d` ON `d`.`id` = `x`.`deliverable_allocation_id`
   SET `x`.`status` = 'CANCELLED', `x`.`parent_extra_id` = NULL
 WHERE `x`.`status` = 'DRAFT'
   AND `d`.`deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');

UPDATE `project_sale_extra` AS `x`
  JOIN `project_post_production_allocation` AS `a` ON `a`.`id` = `x`.`service_allocation_id`
   SET `x`.`status` = 'CANCELLED', `x`.`parent_extra_id` = NULL
 WHERE `x`.`status` = 'DRAFT'
   AND `a`.`deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');

UPDATE `project_sale_extra` AS `x`
  JOIN `project_shoot` AS `s` ON `s`.`id` = `x`.`shoot_id`
   SET `x`.`status` = 'CANCELLED', `x`.`parent_extra_id` = NULL
 WHERE `x`.`status` = 'DRAFT' AND `x`.`category` = 'SHOOT'
   AND `s`.`deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');

UPDATE `project_shoot` SET `sale_baseline` = NULL
 WHERE `deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');
UPDATE `project_post_production_allocation` SET `sale_baseline` = NULL
 WHERE `deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');
UPDATE `project_shoot_deliverable` SET `sale_baseline` = NULL
 WHERE `deleted_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras');
