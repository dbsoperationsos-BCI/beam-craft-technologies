-- Who created it, on the three scoped tables that did not record it.
--
-- Whose records a person sees is decided by the names on the record (see
-- docs/project-state/DATA-SCOPE.md). Whoever *made* a record is one of those names: a lead nobody
-- has been assigned yet is still the work of the person who entered it, and they must not lose
-- sight of it while it waits to be picked up.
--
-- `sales_project`, `asset`, `cash_entry`, `payment_request`, `client_storage`,
-- `sales_whatsapp_group_name` and `sales_project_crd_document` already record it. These three did
-- not, so a lead, a quotation or a task became invisible to the person who created it the moment
-- somebody else was named on it - or, with nobody named, to everybody but a Super Admin.
--
-- A plain user id rather than a foreign key, matching every other creator column in this schema
-- (`sales_project.created_by_user_id`, `asset.created_by`): who did it stays true once that login
-- is gone, and a deleted account must not take the record's history with it.
--
-- Nothing is backfilled. Existing rows have no creator on record and there is nowhere honest to
-- read one from; they answer to the names already on them, and to a branch administrator.
--
-- Cost: three nullable columns and three indexes, built online. Seconds at any size.

ALTER TABLE `sales_crm_lead` ADD COLUMN `created_by_user_id` INT NULL;
CREATE INDEX `sales_crm_lead_created_by_user_id_idx` ON `sales_crm_lead` (`created_by_user_id`);

ALTER TABLE `sales_quotation` ADD COLUMN `created_by_user_id` INT NULL;
CREATE INDEX `sales_quotation_created_by_user_id_idx` ON `sales_quotation` (`created_by_user_id`);

ALTER TABLE `hrm_task` ADD COLUMN `created_by_user_id` INT NULL;
CREATE INDEX `hrm_task_created_by_user_id_idx` ON `hrm_task` (`created_by_user_id`);
