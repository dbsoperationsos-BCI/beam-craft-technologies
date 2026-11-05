-- The remaining lead-children get their key to the lead, and the CRD document its key to the project.
--
-- 20260924130000 keyed the two tables that could take one without a code change. These six wrote
-- "" for "no lead", which a key cannot accept, or pointed at leads since deleted. The rules follow
-- what the application already does when a lead is deleted (`purgeLeads` in crmLeadService):
--
--   sales_project              every booking is created from an enquiry (the form and the import
--                              both require it) -> RESTRICT: a lead with a booking cannot be deleted.
--                              The column allows NULL from here on, only so a legacy row with a
--                              blank or unknown enquiry cannot block the key; such a row is listed
--                              by `npm run report:lead-keys` for somebody to point at its enquiry
--   sales_quotation            quoted against an enquiry, or raised by hand with none
--                                            -> RESTRICT where linked; "" becomes NULL
--   sales_project_crd_document a document sent to a client, against an enquiry or by hand
--                                            -> RESTRICT on the lead, the refusal the app already
--                              gives; and CASCADE from the project it was collected for, which had
--                              no key at all
--   sales_crm_meeting          only ever booked from a lead -> CASCADE: the meeting goes with it
--   sales_whatsapp_group_name  generated for an enquiry, or without one -> CASCADE where linked;
--                              "" becomes NULL
--   sales_call_transcript      a call matched to a lead, or one the studio never turned into an
--                              enquiry -> CASCADE where linked; the column becomes optional and ""
--                              becomes NULL
--
-- Deliberately without a key: sales_google_sheet_row. It is the ledger that remembers which sheet
-- rows were imported *after* their lead is deleted, so the sync does not import them again; a key
-- would either delete that memory or blank it, and either way the deleted lead would come back.
--
-- Nothing is deleted except meetings with no lead, which cannot exist in this application (the two
-- on the development database were test rows). A project with no valid enquiry is kept, with an
-- empty link, for somebody to look at; the migration never guesses which lead it meant.

-- ── "" means no lead, and so does a lead that no longer exists ──
ALTER TABLE `sales_project` MODIFY `enquiry_id` VARCHAR(100) NULL;
UPDATE `sales_project` SET `enquiry_id` = NULL WHERE `enquiry_id` = '' OR (`enquiry_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_project`.`enquiry_id`));
UPDATE `sales_quotation` SET `enquiry_id` = NULL WHERE `enquiry_id` = '' OR (`enquiry_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_quotation`.`enquiry_id`));
UPDATE `sales_project_crd_document` SET `enquiry_id` = NULL WHERE `enquiry_id` = '' OR (`enquiry_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_project_crd_document`.`enquiry_id`));
UPDATE `sales_whatsapp_group_name` SET `enquiry_id` = NULL WHERE `enquiry_id` = '' OR (`enquiry_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_whatsapp_group_name`.`enquiry_id`));
ALTER TABLE `sales_call_transcript` MODIFY `enquiry_id` VARCHAR(100) NULL;
UPDATE `sales_call_transcript` SET `enquiry_id` = NULL WHERE `enquiry_id` = '' OR (`enquiry_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_call_transcript`.`enquiry_id`));
DELETE FROM `sales_crm_meeting` WHERE `enquiry_id` = '' OR NOT EXISTS (SELECT 1 FROM `sales_crm_lead` AS `l` WHERE `l`.`enquiry_id` = `sales_crm_meeting`.`enquiry_id`);

-- ── A document raised by hand is linked to the project it was raised for ──
-- Create CRD Document used to leave `project_id` empty and find the project again through the
-- enquiry on every read. It writes the link now, and the rows already there get it where exactly
-- one live project carries that enquiry and holds no document of its own.
-- Both sides have to be unambiguous: one live project without a document for the enquiry, and one
-- unlinked document for it - two documents could not both take the project (`project_id` is unique),
-- and neither is guessed at. Each side is counted in a derived table, which is the one form MySQL
-- allows when the table being updated is also being read.
UPDATE `sales_project_crd_document` AS `d`
  JOIN (SELECT `p`.`enquiry_id`, MIN(`p`.`id`) AS `id`, COUNT(*) AS `n`
          FROM `sales_project` AS `p`
         WHERE `p`.`deleted_at` IS NULL AND `p`.`enquiry_id` IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM `sales_project_crd_document` AS `x` WHERE `x`.`project_id` = `p`.`id`)
         GROUP BY `p`.`enquiry_id` HAVING `n` = 1) AS `m` ON `m`.`enquiry_id` = `d`.`enquiry_id`
  JOIN (SELECT `y`.`enquiry_id`, COUNT(*) AS `unlinked`
          FROM `sales_project_crd_document` AS `y`
         WHERE `y`.`project_id` IS NULL AND `y`.`enquiry_id` IS NOT NULL
         GROUP BY `y`.`enquiry_id` HAVING `unlinked` = 1) AS `u` ON `u`.`enquiry_id` = `d`.`enquiry_id`
   SET `d`.`project_id` = `m`.`id`
 WHERE `d`.`project_id` IS NULL AND `d`.`enquiry_id` IS NOT NULL;

-- ── The keys ──
UPDATE `sales_project_crd_document` SET `project_id` = NULL WHERE `project_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `sales_project` AS `p` WHERE `p`.`id` = `sales_project_crd_document`.`project_id`);
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_quotation` ADD CONSTRAINT `sales_quotation_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_project_crd_document` ADD CONSTRAINT `sales_project_crd_document_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_project_crd_document` ADD CONSTRAINT `sales_project_crd_document_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_crm_meeting` ADD CONSTRAINT `sales_crm_meeting_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_whatsapp_group_name` ADD CONSTRAINT `sales_whatsapp_group_name_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_call_transcript` ADD CONSTRAINT `sales_call_transcript_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
