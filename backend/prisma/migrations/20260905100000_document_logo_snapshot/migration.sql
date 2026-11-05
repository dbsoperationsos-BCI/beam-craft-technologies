-- The Global Logo a document was issued under, frozen on the row.
--
-- A quotation or CRD document is a record of what was sent, so it keeps the logo it was sent with
-- however many times Settings -> Global Logo changes afterwards. The column is written once, when
-- the row is created, and never updated. Rows that already exist are left NULL on purpose: nothing
-- is known about the logo they were issued under, and they show the bundled default mark rather
-- than whichever logo happens to be configured today.
ALTER TABLE `sales_quotation` ADD COLUMN `logo_url` VARCHAR(500) NULL;
ALTER TABLE `sales_project_crd_document` ADD COLUMN `logo_url` VARCHAR(500) NULL;
