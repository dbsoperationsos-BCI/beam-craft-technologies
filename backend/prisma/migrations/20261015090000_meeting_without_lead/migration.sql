-- Calendar -> Add Meet books a meeting that belongs to no lead: `sales_crm_meeting.enquiry_id` may now
-- be NULL. A meeting booked from a lead still names it, keyed and cascading as before; one with no
-- lead is seen by its organiser and its guests. Every existing row names a lead, so nothing changes
-- for them.
--
-- Cost: the key is dropped and put back around the column change. Instant on this table's size.

ALTER TABLE `sales_crm_meeting` DROP FOREIGN KEY `sales_crm_meeting_enquiry_id_fkey`;

ALTER TABLE `sales_crm_meeting` MODIFY `enquiry_id` VARCHAR(100) NULL;

ALTER TABLE `sales_crm_meeting` ADD CONSTRAINT `sales_crm_meeting_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE CASCADE ON UPDATE CASCADE;
