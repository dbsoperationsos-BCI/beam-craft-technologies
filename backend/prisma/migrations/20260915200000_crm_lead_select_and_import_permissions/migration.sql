-- Selecting a whole board, and importing a file onto one, become permissions of their own.
--
-- Both were carried by `SALES / CRM Leads` Read / Write - the permission that also covers a status,
-- a follow-up date and a remark - so everybody who could work a board could rewrite it wholesale or
-- land a file on it. They are their own rows now, for the same reason `CRM Lead Deletion` is:
-- working a board one lead at a time and acting on the whole of it at once are different jobs.
--
-- Here as a migration rather than as a line in the seed alone, because **the seed cannot be run on
-- production**. A guard naming a `module / feature` the `permission` table does not hold refuses
-- everybody but a Super Admin, and says so to nobody - CLAUDE.md Rule 4 - so without these two rows
-- the guards in `crm-leads/routes.js` would quietly close the tick boxes and the CSV import to the
-- entire studio. `seeds/permission-catalogue.js` holds the same two rows and upserts on
-- `module + feature + level`, so a seeded environment finds these rather than making a second pair.
--
-- **No grants are copied, and that is the point.** Unlike the Settings split beside this, these two
-- are meant to start withheld: the studio decides who may rewrite a whole vertical at once and who
-- may land a file of leads, and inheriting them from `CRM Leads` would leave nothing restricted,
-- which is the opposite of what they are for. After this runs, only a Super Admin selects or
-- imports until the roles that should have them are ticked in Role Management.
--
-- Cost: two rows. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', `new`.`feature`, `new`.`level`, `new`.`display_name`, `new`.`description`, 1, NOW(3), NOW(3)
FROM (
  SELECT 'CRM Lead Select All' AS `feature`, 'LEAD_SELECT_ALL' AS `level`, 'Select Leads in Bulk' AS `display_name`,
         'Read / Write to tick leads on the board and act on the whole selection at once - Update Details, and the bulk delete for a role that also holds CRM Lead Deletion. Without it the tick boxes are absent and leads are worked one at a time' AS `description`
  UNION ALL SELECT 'CRM Lead Import', 'LEAD_IMPORT', 'Import Leads',
         'Read / Write to bring a CSV of leads onto a board. Without it the CRM is fully workable and Bulk Entry still types leads in a handful at a time'
) AS `new`
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SALES'
    AND `existing`.`feature` = `new`.`feature`
    AND `existing`.`level` = `new`.`level`
);
