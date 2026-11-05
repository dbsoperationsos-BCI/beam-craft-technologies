-- Production → Import keeps the name of somebody who has left the studio.
--
-- The production board holds people as links to an employee only, so a coordinator, a team member or a
-- photo-copy backup who has since left the company - and whose name the old sheet still carries - had
-- nowhere to be written. Each now has a name column beside its link, filled only where nothing is
-- linked (a linked person is always read from the employee, never from this text), and shown on the
-- board as written.
--
-- Cost: three nullable columns, no default, no index. No existing row is touched, and nothing is
-- rewritten - the columns are empty until a production import names someone who has left.

ALTER TABLE `project_production` ADD COLUMN `production_coordinator_name` VARCHAR(191) NULL;
ALTER TABLE `project_production_team_member` ADD COLUMN `employee_name` VARCHAR(191) NULL;
ALTER TABLE `project_production_footage` ADD COLUMN `backed_up_by_name` VARCHAR(191) NULL;
