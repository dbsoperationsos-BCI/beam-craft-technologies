-- `ASSET / Asset Administration`, written where production can hold it.
--
-- Adding equipment to the register is carved out of `ASSET / Asset Management`. That permission is
-- meant to be held widely - it is how somebody sees the camera in their hands, reports it faulty
-- and asks for a new lens - and until now `READ_WRITE` on it also carried **Add Asset**. Deciding
-- what the studio owns is a different job from looking after a piece of it, so it gets its own row.
--
-- The seed cannot be run on production (CLAUDE.md), so a permission added only to
-- `seeds/permission-catalogue.js` never reaches the VPS - and a guard naming a permission the
-- `permission` table does not hold refuses everybody but a Super Admin, silently. IAM.md step 10 is
-- what this is: the catalogue makes it grantable where the seed runs, the migration makes it exist
-- everywhere. Same `module`, `feature` and `level` as the catalogue, which is what the seed upserts
-- on, so a seeded environment finds this row rather than making a second one.
--
-- **No grants are carried across from `Asset Management`, deliberately.** Copying them would hand
-- Add Asset to every role holding the widely-granted permission, which is the exact thing being
-- undone here. Until the roles that should administer assets are ticked in Role Management and
-- re-saved, **only a Super Admin can add an asset** - which is safe, and is the point.
--
-- SUPER_ADMIN is the one exception, below: it is described as holding every permission there is, a
-- new one it does not hold is a hole in the only role meant to have none, and it cannot be filled
-- from Role Management, which refuses to edit a system role.
--
-- Approving an asset request still creates the asset it asked for on `Asset Request Approval`
-- alone; that is a decision of the studio's, recorded in IAM.md, not an oversight.
--
-- Cost: one row. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'ASSET', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Asset Administration' AS `feature`, 'ASSET_ADMINISTER' AS `level`, 'Administer Assets' AS `display_name`,
         'Add assets to the register, singly or in bulk, and name who holds and manages them' AS `description`
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'ASSET'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'ASSET_ADMINISTER'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
