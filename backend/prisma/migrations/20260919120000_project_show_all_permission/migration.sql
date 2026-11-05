-- `PROJECT / Show All Projects`, written where production can hold it.
--
-- The permission was added to `seeds/permission-catalogue.js`, and that alone reaches nothing.
-- **The seed cannot be run on production** (see CLAUDE.md, Hard Constraints), so on the VPS the
-- `permission` table would never gain this row - and a guard naming a permission the table does not
-- hold refuses everybody but a Super Admin, silently. Role Management could not grant it to anyone,
-- so the very people it exists for would not be able to be given it. IAM.md step 10 is what this
-- is: the catalogue makes a permission grantable where the seed is run; a migration makes it exist
-- everywhere. Same `module`, `feature` and `level` as the catalogue, which is what the seed upserts
-- on, so a seeded environment finds this rather than making a second row.
--
-- ── Why it exists ────────────────────────────────────────────────────────────────────────────
--
-- Changing a project belongs to the people it is staffed to, and deleting it to its Project
-- Manager. That is right for a project with people on it and leaves a gap on one without:
-- **a Yet to Start project is staffed to nobody**, because those seats are filled in on the Start
-- Project form and not on the booking form. So a freshly booked project could be started only by a
-- holder of `ADMIN / Branch Administration`, and the studio has people whose job is exactly that
-- and who are not branch administrators.
--
--   * **Read** shows every project in the studio and offers nothing else - the row menu is View
--     alone, with no Edit, no Start and no Delete.
--   * **Read / Write** may edit, start and delete any project, staffed to them or not.
--
-- ── No grants are copied ─────────────────────────────────────────────────────────────────────
--
-- It did not exist before, so there is nothing to carry across, and inheriting it from
-- `PROJECT / Projects` would hand the whole register to every role that can plan one - which is the
-- opposite of a permission that exists to be given deliberately. After this runs, only a Super
-- Admin has it until the roles that should hold it are ticked in Role Management and **re-saved**:
-- neither this migration nor the seed writes a grant.
--
-- Cost: one row. Instant. Re-running writes nothing.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'PROJECT', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'Show All Projects' AS `feature`, 'PMPROJECT_SHOW_ALL' AS `level`, 'Show All Projects' AS `display_name`,
         'See every project in the studio, not only the ones you are staffed to. Read views the whole register and offers nothing else; Read / Write edits, starts and deletes any project' AS `description`
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'PROJECT'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);
