-- The Signature Album tab reaches the people who already run Image Selection projects.
--
-- 20260924100000 created `IMAGE_SELECTION / Signature Album` and granted it to SUPER_ADMIN alone,
-- so on every other role the tab a project had been given simply vanished from the workspace the
-- moment the code shipped - the `Project Management` row opens the project, and the tab inside it
-- answered to a permission nobody had been handed. The tab is a part of the same job: the studio
-- that builds the selection gallery is the studio that builds the album from it. So every role
-- holding `Project Management` is given `Signature Album` at the level it already holds - READ
-- stays READ, READ_WRITE stays READ_WRITE - and a role that was never allowed into Image Selection
-- gains nothing. Role Management can narrow any of them afterwards.
--
-- Written only where the grant is missing, so a re-run and a role somebody granted by hand are
-- both left alone. Column-to-literal comparisons only (IAM.md step 10).
--
-- Cost: one row per role holding Project Management. Instant.

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `grant`.`roleId`, `new`.`id`, `grant`.`access_level`, NOW(3), NOW(3)
FROM `role_permission` AS `grant`
JOIN `permission` AS `old`
  ON `old`.`id` = `grant`.`permissionId`
 AND `old`.`module` = 'IMAGE_SELECTION'
 AND `old`.`feature` = 'Project Management'
 AND `old`.`level` = 'ISPROJECT_MANAGE'
JOIN `permission` AS `new`
  ON `new`.`module` = 'IMAGE_SELECTION'
 AND `new`.`feature` = 'Signature Album'
 AND `new`.`level` = 'ISSIGNATURE_ALBUM'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permission` AS `already`
  WHERE `already`.`roleId` = `grant`.`roleId`
    AND `already`.`permissionId` = `new`.`id`
);
