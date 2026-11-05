-- CRD documents raised by hand, left without the vertical reference beside their vertical text.
--
-- `20260906160000_data_scope_backfill` stamped `vertical_id` on every row that existed when it ran.
-- The create path behind Create CRD Document did not stamp it on the rows written afterwards - that
-- was fixed in `crd-documents/service.js`, but only for rows written from then on. Anything issued
-- by that button in between holds a vertical the reader can see and a reference the data scope
-- cannot, which is what `data-scope-backfill.test.js` fails on.
--
-- The two statements are the vertical half of that backfill, restricted to this one table and
-- unchanged otherwise: exact spelling first, then the CRM's own aliases. `WHERE vertical_id IS NULL`
-- makes both idempotent and keeps them off every row that is already correct.

UPDATE `sales_project_crd_document` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `sales_project_crd_document` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
