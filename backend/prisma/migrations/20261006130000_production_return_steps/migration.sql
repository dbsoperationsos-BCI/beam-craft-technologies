-- Production's three new steps: Happening now and Happy clients after Shoot started, and Started
-- from venue (the trip back) after Shoot status. Each keeps when it was completed and an optional
-- remark. Columns only - no row is changed; a shoot already past a new step carries on from its own.
ALTER TABLE `project_production`
    ADD COLUMN `happening_now_at` DATETIME(3) NULL,
    ADD COLUMN `happy_clients_at` DATETIME(3) NULL,
    ADD COLUMN `started_from_venue_at` DATETIME(3) NULL,
    ADD COLUMN `happening_now_remarks` TEXT NULL,
    ADD COLUMN `happy_clients_remarks` TEXT NULL,
    ADD COLUMN `started_from_venue_remarks` TEXT NULL;
