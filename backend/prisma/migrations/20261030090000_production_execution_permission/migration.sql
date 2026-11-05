-- Running a shoot's execution steps becomes a permission of its own: PROJECT / Production Execution.
--
-- Until now anybody holding `PROJECT / Production` Read / Write who was named on a shoot (its
-- Production Coordinator, the project's Production Manager, its Production Team or a service's crew)
-- completed its steps. Being named still decides *which* shoots; this permission decides *whether* a
-- person runs steps at all (`production/access.js` `accessFor`).
--
-- Here as a migration because **the seed cannot be run on production** (CLAUDE.md Rule 4).
-- `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature + level`.
--
-- **Granted to SUPER_ADMIN only.** Every other role starts without it, so after this runs only a
-- Super Admin and holders of `PROJECT / Show All Projects` Read / Write run steps, until the studio
-- ticks it in Role Management for the roles that should.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'PROJECT', 'Production Execution', 'PRODUCTION_EXECUTION', 'Production Execution',
       'Read / Write to run the execution steps of the shoots you are named on in Production. Also needs PROJECT / Production Read / Write',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'PROJECT'
    AND `existing`.`feature` = 'Production Execution'
    AND `existing`.`level` = 'PRODUCTION_EXECUTION'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
  FROM `role` JOIN `permission` ON `permission`.`module` = 'PROJECT'
                               AND `permission`.`feature` = 'Production Execution'
                               AND `permission`.`level` = 'PRODUCTION_EXECUTION'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
