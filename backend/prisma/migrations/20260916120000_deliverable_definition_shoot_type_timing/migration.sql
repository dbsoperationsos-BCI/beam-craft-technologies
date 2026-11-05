-- A deliverable says which shoot it is for, and how it is timed - the same four columns a service
-- has carried since `service_shoot_types_and_timings` and `service_default_duration`.
--
-- Settings → Project → Deliverables → Add / Edit Deliverable asks for Shoot Type, Session Timing
-- and Duration now, exactly as Edit Service does, and a project's Choose Deliverables picker offers
-- a deliverable only on a shoot of its type. Every column is NULL on the rows already here, which
-- reads as "every shoot, no timing" - what those deliverables have always meant - so nothing that
-- exists changes until somebody edits it.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_deliverable_definition`
  ADD COLUMN `shoot_types` JSON NULL,
  ADD COLUMN `timing_modes` JSON NULL,
  ADD COLUMN `default_duration_hours` INT NULL,
  ADD COLUMN `default_duration_minutes` INT NULL;
