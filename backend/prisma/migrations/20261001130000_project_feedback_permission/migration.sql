-- Project Management → Feedback: the permission that opens the new screen.
--
-- The screen lists the feedback given on each shoot and holds Add Feedback. It is a route, a sidebar
-- entry and a guard, and a guard may only name a permission that exists. So
-- `PROJECT / Feedback` is written here as well as in `seeds/permission-catalogue.js`, because **the
-- seed cannot be run on production** (IAM.md step 10): a permission in the catalogue alone never
-- reaches the VPS, and the route guard naming it would refuse everybody but a Super Admin. Same
-- `module`, `feature` and `level` as the catalogue, which is what the seed upserts on, so a seeded
-- environment finds this row rather than making a second one.
--
-- **SUPER_ADMIN alone is granted it**, as every new permission must be
-- (test/iam-super-admin-grants.test.js). No other role is: nothing held this before, and copying it
-- from another Project permission would hand a screen to roles that were never given it. Tick it in
-- Administration → Roles for the roles that should see Feedback, and re-save them.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'PROJECT', 'Feedback', 'FEEDBACK_MANAGE', 'Feedback',
       'Project Management feedback: reviews of each shoot, and Add Feedback',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'PROJECT' AND `existing`.`feature` = 'Feedback' AND `existing`.`level` = 'FEEDBACK_MANAGE'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'PROJECT' AND `permission`.`feature` = 'Feedback' AND `permission`.`level` = 'FEEDBACK_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
