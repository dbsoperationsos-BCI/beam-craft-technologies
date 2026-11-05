-- A CRD document no longer has to hang off a project. The studio issues the client's link from the
-- CRD Documents screen before a project exists, so `project_id` becomes nullable and the details
-- the create dialog asks for are kept on the document itself. MySQL allows any number of nulls
-- under a unique index, so one document per project still holds for the project-backed rows.
ALTER TABLE `sales_project_crd_document`
  MODIFY COLUMN `project_id` VARCHAR(191) NULL,
  ADD COLUMN `vertical` VARCHAR(10) NULL,
  ADD COLUMN `enquiry_id` VARCHAR(100) NULL,
  ADD COLUMN `client_name` VARCHAR(191) NULL,
  ADD COLUMN `groom_name` VARCHAR(150) NULL,
  ADD COLUMN `bride_name` VARCHAR(150) NULL,
  ADD COLUMN `contact_number` VARCHAR(30) NULL;

CREATE INDEX `sales_project_crd_document_enquiry_id_idx` ON `sales_project_crd_document`(`enquiry_id`);
