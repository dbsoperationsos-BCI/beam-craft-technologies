-- AI Culling reaches the people who cull today.
--
-- 20261103120000 created `IMAGE_SELECTION / AI Culling` and granted it to SUPER_ADMIN alone. AI
-- Culling has since moved out of the Photo Selection project workspace into a Visual Curation
-- module of its own - its own Dashboard, Projects page and project workspace - and that module
-- opens on AI Culling. Until now culling was a tab of the project `Project Management` opens, so
-- every role holding Project Management could cull; left at Super Admin alone, all of them would
-- lose culling the moment the code shipped. The studio asked for it to follow (3 Nov 2026), as
-- Signature Album's did in 20260924110000: every role holding `Project Management` is given
-- `AI Culling` at the level it already holds - READ stays READ, READ_WRITE stays READ_WRITE - and
-- a role that was never allowed into Image Selection gains nothing. Role Management can narrow any
-- of them afterwards. The culling endpoints themselves still answer to Project Management.
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
 AND `new`.`feature` = 'AI Culling'
 AND `new`.`level` = 'ISAI_CULLING'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permission` AS `already`
  WHERE `already`.`roleId` = `grant`.`roleId`
    AND `already`.`permissionId` = `new`.`id`
);
