-- Employees created or edited by hand, left without the branch and vertical references beside their
-- free-text ones.
--
-- `20260906160000_data_scope_backfill` stamped `branch_id` and `vertical_id` on every employee that
-- existed when it ran. The create and update paths behind Employee Repository did not stamp them on
-- the rows written afterwards - that was fixed in `employees/controller.js` (`referenceColumnsFor`)
-- on 2026-09-15, but only for rows written from then on. Any employee saved in between holds a
-- vertical and a work location the reader can see and references the data scope cannot, which is
-- what `data-scope-backfill.test.js` fails on - and, worse, what the attendance geofence reads:
-- with `branch_id` NULL every capture answers "no branch on their record", so that person can never
-- be inside their own office.
--
-- The statements are the employee half of that backfill, unchanged: the branch is the work base,
-- falling back to the current location, matched on exact spelling, then on the branch's first word
-- where it is unique, then "Vizag"; the vertical is matched on any of its names and codes, then on
-- the CRM's own aliases. `WHERE ... IS NULL` makes every statement idempotent and keeps them off the
-- rows that are already correct.

-- employee.work_base_location -> branch_id
UPDATE `employee` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = 'vizag';
-- employee.current_work_location -> branch_id
UPDATE `employee` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = 'vizag';

-- employee.vertical -> vertical_id
UPDATE `employee` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `employee` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
