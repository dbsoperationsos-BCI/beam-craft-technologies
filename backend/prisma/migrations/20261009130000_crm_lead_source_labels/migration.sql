-- A lead's Source says how it came into the CRM, one label per way in (`leadSources.js`):
-- Manual Entry, CSV Import, Google Sheet Integration, Callyzer. The sheet sync and the CSV import
-- used to copy the file's own "Source" cell (Instagram, a campaign name) instead, and leads typed into
-- the app had none. This puts the stored leads on the labels. Data only - no column changes.

-- Every lead the sheet sync wrote: only that sync sets `spreadsheet_id`.
UPDATE `sales_crm_lead`
SET `source` = 'Google Sheet Integration'
WHERE COALESCE(`spreadsheet_id`, '') <> '';

-- CSV imports: the import keys a row it gave an id to as `csv-<batch>:<row>`, and wrote "CSV import"
-- where the file had no Source of its own. A CSV row that brought both its own Enquiry ID and a
-- Source left neither mark and is left as it is.
UPDATE `sales_crm_lead`
SET `source` = 'CSV Import'
WHERE COALESCE(`spreadsheet_id`, '') = ''
  AND (COALESCE(`source_enquiry_id`, '') LIKE 'csv%' OR LOWER(TRIM(COALESCE(`source`, ''))) = 'csv import');

-- Typed into the app: Add Lead and Bulk Entry never set a Source, so these are the blank ones.
UPDATE `sales_crm_lead`
SET `source` = 'Manual Entry'
WHERE COALESCE(`spreadsheet_id`, '') = ''
  AND TRIM(COALESCE(`source`, '')) = '';
