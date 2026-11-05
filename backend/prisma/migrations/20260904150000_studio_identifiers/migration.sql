-- The two records that had no identifier of their own.
--
-- Every other module already had one - a lead, a booking, a quotation, an asset, a vendor - but a
-- CRD document was known only by the project it belonged to, and an Image Selection project only by
-- its name. Both are now handed one from the same counter as everything else, so the studio can say
-- "DBS-CRD-DD-000004" over the phone about either of them.
--
-- Nullable because the rows that already exist have none until the backfill fills them in, and
-- unique because two records sharing an identifier is the one thing this must never allow.
ALTER TABLE `sales_project_crd_document`
  ADD COLUMN `document_code` VARCHAR(40) NULL,
  ADD UNIQUE INDEX `sales_project_crd_document_document_code_key`(`document_code`);

ALTER TABLE `image_selection_project`
  ADD COLUMN `project_code` VARCHAR(40) NULL,
  ADD UNIQUE INDEX `image_selection_project_project_code_key`(`project_code`);
