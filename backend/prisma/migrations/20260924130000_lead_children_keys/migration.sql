-- The two lead-owned tables that can take a real key to the lead today.
--
-- Nine tables name their lead by `enquiry_id` as a plain string. A key is possible on the two
-- whose rows exist only as part of the lead and always carry its id: the occasion rows (a lead's
-- birthdays and anniversaries) and the watch row. Both go with the lead if it is ever deleted,
-- which is what the code already does by hand. Checked on the studio's data before writing: no row
-- of either is blank or points at a lead that does not exist.
--
-- The other seven wait, and the reason is the same for each: they use an **empty string** to mean
-- "no lead" - 13 of 13 quotations, 12 of 12 saved group names, 20 of 22 CRD documents, 4 projects
-- and 2 meetings on the studio's data - and a key cannot accept that. Each needs its writers to store
-- nothing instead of "" first (a code change, not a migration), and two of them hold history worth
-- keeping: 165 sheet rows and 5 call transcripts name leads that have since been removed.

ALTER TABLE `sales_crm_lead_occasion` ADD CONSTRAINT `sales_crm_lead_occasion_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_crm_lead_watch` ADD CONSTRAINT `sales_crm_lead_watch_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
