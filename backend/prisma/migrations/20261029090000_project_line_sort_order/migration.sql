-- The order a project's service and deliverable lines are shown in, within their shoot.
--
-- Nullable with no default: every line already saved stays NULL and keeps showing in the order it
-- was added (created_at), exactly as today. A line gets a position only when someone drags it.
--
-- Two nullable columns added, no existing value changed, so there is nothing to fail on production data.

ALTER TABLE `project_post_production_allocation` ADD COLUMN `sort_order` INT NULL;
ALTER TABLE `project_shoot_deliverable` ADD COLUMN `sort_order` INT NULL;
