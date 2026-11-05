-- Album Proofing's two permissions, written where production can hold them.
--
-- `IMAGE_SELECTION / Album Proofing` and `IMAGE_SELECTION / Album Proofing QC` were added to
-- `seeds/permission-catalogue.js` alone. **The seed cannot be run on production**, so on the VPS
-- the `permission` table never gains them - and a guard naming a permission the table does not
-- hold refuses everybody but a Super Admin, and says so to nobody (CLAUDE.md Rule 4). The sidebar
-- lists a screen only where its permission is held, so the whole studio would simply not see
-- **Album Proofing** under Visual Curation, and Role Management could not grant it to anyone.
-- IAM.md step 10 is what this is: the catalogue makes a permission grantable where the seed is
-- run; a migration makes it exist everywhere. Same `module`, `feature` and `level` as the
-- catalogue, which is what the seed upserts on, so a seeded environment finds these rather than
-- making a second pair.
--
-- Two rows rather than one because they are two jobs done by different people: the admin or
-- designer runs the album (create, import, resolve corrections, publish to the client), while the
-- QC Lead only reviews and decides.
--
-- **No grants are copied.** Neither existed before, so there is nothing to carry across, and
-- inheriting them from `Project Management` would hand every Image Selection role a screen it was
-- not given. After this runs, only a Super Admin opens Album Proofing until the roles that should
-- have it are ticked in Role Management.
--
-- Cost: two rows. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Album Proofing' AS `feature`, 'ISALBUM_PROOFING' AS `level`, 'Album Proofing' AS `display_name`,
         'Create and run album proofs: folders, imports, corrections, revisions, client publication and final download' AS `description`
  UNION ALL SELECT 'Album Proofing QC', 'ISALBUM_PROOFING_QC', 'Album Proofing QC',
         'Review album proof versions as QC Lead: add corrections, request changes, approve for the client'
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);
