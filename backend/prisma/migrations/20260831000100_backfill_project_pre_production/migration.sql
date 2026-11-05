-- Give the shoots that already qualify their pre production rows.
--
-- From here on a row is raised by `ensureProjectPreProduction`, called when the Start Project form
-- is saved and when shoots are added. Neither has happened yet for a project started before this
-- feature existed, so without this the coordinators already named would open the board and find it
-- empty — the one case where "assignment routes the work" would visibly not hold.
--
-- The conditions are `ensureProjectPreProduction`'s own, written once more in SQL: a live shoot on
-- a live project that has been started and has a Pre Production Coordinator, by employee id or by
-- the denormalised name a legacy row carries on its own.
--
-- INSERT IGNORE rather than a NOT EXISTS: the unique index on `shoot_id` is what makes this
-- idempotent, and MySQL will not have the target table read inside its own INSERT ... SELECT.
-- `UUID()` only has to be unique, and never collides with the cuids the application generates.
INSERT IGNORE INTO `project_pre_production`
  (`id`, `shoot_id`, `project_id`, `completion_status`, `travel_accommodation_needed`, `waiting_for_client_reply`, `created_at`, `updated_at`)
SELECT
  UUID(),
  s.`id`,
  s.`project_id`,
  'Not Started',
  false,
  false,
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
