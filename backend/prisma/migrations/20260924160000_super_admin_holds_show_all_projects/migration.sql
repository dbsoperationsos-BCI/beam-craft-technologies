-- SUPER_ADMIN holds `PROJECT / Show All Projects`, which it never has.
--
-- The permission was created by 20260919120000_project_show_all_permission. That migration wrote
-- the `permission` row and, deliberately, no grants - "only a Super Admin has it until the roles
-- that should hold it are ticked in Role Management". That sentence is true of the *login* whose
-- `user.role` column says SUPER_ADMIN, because `iamService` short-circuits on that column without
-- reading a grant. It is not true of the **role** named SUPER_ADMIN, which is granted its
-- permissions as rows like any other role - and this one was missed, because the migration predates
-- the convention that a migration adding a permission also grants it to that role (see
-- 20260921120000_asset_administration_permission and the two after it, which all do).
--
-- So an administrator added the way the studio actually adds one - a login whose `role` column says
-- EMPLOYEE, carrying the SUPER_ADMIN role - is refused the whole-studio project register, silently,
-- while every screen tells them they have full access. `iam-super-admin-grants.test.js` holds the
-- invariant that the role holds every active permission at READ_WRITE, and names this as the hole.
--
-- The earlier migration is not edited: it is in git and has run everywhere. This adds only what is
-- missing, and adds it the way the grant migrations beside it do.
--
-- Idempotent, which is not optional: a migration that inserts blindly fails on its second run
-- against the unique key and stops the next deploy. The LEFT JOIN is what makes re-running write
-- nothing, and what makes this safe on a database where somebody has already granted it by hand.
--
-- No other role is touched, and no scope or branch is written - the role already reaches every
-- branch. Cost: one row. Instant.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role`
  JOIN `permission`
    ON `permission`.`module` = 'PROJECT'
   AND `permission`.`feature` = 'Show All Projects'
   AND `permission`.`level` = 'PMPROJECT_SHOW_ALL'
  LEFT JOIN `role_permission`
    ON `role_permission`.`roleId` = `role`.`id`
   AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN'
   AND `role_permission`.`id` IS NULL;
