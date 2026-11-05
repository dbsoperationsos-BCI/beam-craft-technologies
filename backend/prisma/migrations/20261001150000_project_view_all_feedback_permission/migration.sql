-- Project Management → Feedback: `PROJECT / View All Feedback`, the action permission that shows
-- everybody's feedback rather than only one's own.
--
-- Without it the Feedback list holds only the feedback the reader gave. With it, everybody's, as
-- far as the branches of the roles granting it reach. It opens no screen of its own, so Role
-- Management lists it among Project Management's action permissions.
--
-- Written here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on
-- production (IAM.md step 10). Same `module`, `feature` and `level` as the catalogue, which is what
-- the seed upserts on, so a seeded environment finds this row rather than making a second one.
--
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for the roles that should
-- see everybody's feedback, and re-save them.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'PROJECT', 'View All Feedback', 'FEEDBACK_VIEW_ALL', 'View All Feedback',
       'See everybody''s feedback on the Feedback screen, not only your own',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'PROJECT' AND `existing`.`feature` = 'View All Feedback' AND `existing`.`level` = 'FEEDBACK_VIEW_ALL'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'PROJECT' AND `permission`.`feature` = 'View All Feedback' AND `permission`.`level` = 'FEEDBACK_VIEW_ALL'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
