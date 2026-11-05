-- Every studio branch, vertical and owner that a record holds as text gets a reference beside it.
--
-- These are the columns the data scope resolver will narrow on (DATA-SCOPE.md, "The resolver"):
-- `branch_id` for BRANCH, `owner_employee_id` for TEAM and SELF, and `vertical_id` for the same
-- reason the CRM lead got one in 20260906110000 - the vertical is a row of the `vertical` table,
-- spelled three ways across the schema. All nullable, all indexed, all FOREIGN KEYs that SET NULL
-- when the referenced row goes, so retiring a branch or an employee never refuses.
--
-- Nothing is backfilled. Every one of these is NULL after this migration, and the text column
-- beside it stays what every screen reads. Which row each text value maps to is decided from the
-- match report (`npm run report:data-scope`), and written by the next migration once the rule is
-- approved - because "Erode" and "Erode TN" are the same branch written two ways, and a rule that
-- guessed would guess in production too.
--
-- Not here, on purpose:
--   * `hrm_task`'s owner. Tasks are assigned between logins (`assigned_to_user_id`), and moving
--     that to an employee is a decision the report puts to whoever approves it, not a column.
--   * `sales_project`'s owner. It already carries `crm_employee_id`, `project_manager_employee_id`
--     and `creative_manager_employee_id` as plain integers; which of them is "the owner" is asked
--     in the report, and the one chosen gets its foreign key with the backfill.
--   * `cash_entry` and `payment_request` owners: `handler_employee_id` and `requested_by_id` are
--     already real references.
--   * `sales_google_sheet_link.vertical`: integration configuration, not a business record.
--
-- Cost: adding nullable columns is a metadata change in InnoDB; the indexes and keys are built
-- online against columns that are NULL in every row. Seconds at any size.

-- CRM leads: the physical branch (`assigned_branch`) and the CRM who owns it (`crm`, a name).
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `branch_id` INT NULL AFTER `assigned_branch`,
  ADD COLUMN `owner_employee_id` INT NULL AFTER `crm`;
CREATE INDEX `sales_crm_lead_branch_id_idx` ON `sales_crm_lead` (`branch_id`);
CREATE INDEX `sales_crm_lead_owner_employee_id_idx` ON `sales_crm_lead` (`owner_employee_id`);
ALTER TABLE `sales_crm_lead`
  ADD CONSTRAINT `sales_crm_lead_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_crm_lead_owner_employee_id_fkey` FOREIGN KEY (`owner_employee_id`) REFERENCES `employee` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Projects: `source_branch` ("Erode TN") and `vertical` ("WED").
ALTER TABLE `sales_project`
  ADD COLUMN `branch_id` INT NULL AFTER `source_branch`,
  ADD COLUMN `vertical_id` INT NULL AFTER `vertical`;
CREATE INDEX `sales_project_branch_id_idx` ON `sales_project` (`branch_id`);
CREATE INDEX `sales_project_vertical_id_idx` ON `sales_project` (`vertical_id`);
ALTER TABLE `sales_project`
  ADD CONSTRAINT `sales_project_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_project_vertical_id_fkey` FOREIGN KEY (`vertical_id`) REFERENCES `vertical` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Quotations: `source_branch` ("Erode") and `followed_by` (a name).
ALTER TABLE `sales_quotation`
  ADD COLUMN `branch_id` INT NULL AFTER `source_branch`,
  ADD COLUMN `owner_employee_id` INT NULL AFTER `followed_by`;
CREATE INDEX `sales_quotation_branch_id_idx` ON `sales_quotation` (`branch_id`);
CREATE INDEX `sales_quotation_owner_employee_id_idx` ON `sales_quotation` (`owner_employee_id`);
ALTER TABLE `sales_quotation`
  ADD CONSTRAINT `sales_quotation_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_quotation_owner_employee_id_fkey` FOREIGN KEY (`owner_employee_id`) REFERENCES `employee` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Cash entries and payment requests: `branch` ("Erode TN"); their owners are already references.
ALTER TABLE `cash_entry` ADD COLUMN `branch_id` INT NULL AFTER `branch`;
CREATE INDEX `cash_entry_branch_id_idx` ON `cash_entry` (`branch_id`);
ALTER TABLE `cash_entry`
  ADD CONSTRAINT `cash_entry_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payment_request` ADD COLUMN `branch_id` INT NULL AFTER `branch`;
CREATE INDEX `payment_request_branch_id_idx` ON `payment_request` (`branch_id`);
ALTER TABLE `payment_request`
  ADD CONSTRAINT `payment_request_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Tasks: `branch` (blank so far).
ALTER TABLE `hrm_task` ADD COLUMN `branch_id` INT NULL AFTER `branch`;
CREATE INDEX `hrm_task_branch_id_idx` ON `hrm_task` (`branch_id`);
ALTER TABLE `hrm_task`
  ADD CONSTRAINT `hrm_task_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- WhatsApp group names: `branch` ("Erode TN") and `vertical` ("WED").
ALTER TABLE `sales_whatsapp_group_name`
  ADD COLUMN `branch_id` INT NULL AFTER `branch`,
  ADD COLUMN `vertical_id` INT NULL AFTER `vertical`;
CREATE INDEX `sales_whatsapp_group_name_branch_id_idx` ON `sales_whatsapp_group_name` (`branch_id`);
CREATE INDEX `sales_whatsapp_group_name_vertical_id_idx` ON `sales_whatsapp_group_name` (`vertical_id`);
ALTER TABLE `sales_whatsapp_group_name`
  ADD CONSTRAINT `sales_whatsapp_group_name_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `sales_whatsapp_group_name_vertical_id_fkey` FOREIGN KEY (`vertical_id`) REFERENCES `vertical` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CRD documents and employees: `vertical` only.
ALTER TABLE `sales_project_crd_document` ADD COLUMN `vertical_id` INT NULL AFTER `vertical`;
CREATE INDEX `sales_project_crd_document_vertical_id_idx` ON `sales_project_crd_document` (`vertical_id`);
ALTER TABLE `sales_project_crd_document`
  ADD CONSTRAINT `sales_project_crd_document_vertical_id_fkey` FOREIGN KEY (`vertical_id`) REFERENCES `vertical` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee` ADD COLUMN `vertical_id` INT NULL AFTER `vertical`;
CREATE INDEX `employee_vertical_id_idx` ON `employee` (`vertical_id`);
ALTER TABLE `employee`
  ADD CONSTRAINT `employee_vertical_id_fkey` FOREIGN KEY (`vertical_id`) REFERENCES `vertical` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
