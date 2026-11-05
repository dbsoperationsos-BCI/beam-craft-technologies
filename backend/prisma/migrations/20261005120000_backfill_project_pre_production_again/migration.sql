-- Raise the pre production rows any qualifying shoot is still missing.
--
-- The same rule as `ensureProjectPreProduction` and the 2026-08-31 backfill: a live shoot on a live
-- project that has been started and has a Pre Production Coordinator. Every save in the app raises
-- these rows, but a project written another way (an import, a script, data copied in) can be
-- started and staffed without them - and then Pre Production has nothing to open for it, not even
-- for a Super Admin, which is what a project's Status tab ran into.
--
-- INSERT IGNORE on the unique `shoot_id`, so a shoot that has its row keeps it untouched and this
-- is safe to replay. Only the identifying columns are written; every other column takes its default.
INSERT IGNORE INTO `project_pre_production`
  (`id`, `shoot_id`, `project_id`, `created_at`, `updated_at`)
SELECT
  UUID(),
  s.`id`,
  s.`project_id`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `project_shoot` s
JOIN `sales_project` p ON p.`id` = s.`project_id`
WHERE s.`deleted_at` IS NULL
  AND p.`deleted_at` IS NULL
  AND p.`project_status` <> 'Yet to Start'
  AND (
    p.`pre_production_coordinator_employee_id` IS NOT NULL
    OR TRIM(COALESCE(p.`pre_production_coordinator`, '')) <> ''
  );
