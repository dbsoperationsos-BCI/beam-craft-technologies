-- Recycling Bin, tightened.
--
-- `sales_project.purging_at`: set by Delete permanently before anything is destroyed, so a Restore
-- or a second Delete permanently arriving meanwhile is refused instead of racing it. NULL on every
-- project.
--
-- `user.deactivated_with_project_at`: the deletion time of the project whose delete switched this
-- client login from ACTIVE to INACTIVE. Restore turns back on only a login carrying that exact time
-- and still INACTIVE. NULL on every login.
--
-- `sales_project.client_login_deactivated_on_delete` (added by 20261029170000, a project-wide
-- boolean) is replaced by the per-login stamp above and dropped. It has never left a developer's
-- machine and nothing reads it; on any database it holds only its default for live projects.

ALTER TABLE `sales_project` ADD COLUMN `purging_at` DATETIME(3) NULL;
ALTER TABLE `sales_project` DROP COLUMN `client_login_deactivated_on_delete`;
ALTER TABLE `user` ADD COLUMN `deactivated_with_project_at` DATETIME(3) NULL;
