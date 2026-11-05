-- The generator's branch is now a full name from the locations master data ("Coimbatore TN"),
-- not one of the old seven codes, so the column grows to the width location names have.
ALTER TABLE `sales_whatsapp_group_name` MODIFY `branch` VARCHAR(120) NOT NULL;

-- The CRM lead a group name is prepared for. Nullable: names generated before the generator
-- asked for an enquiry have none.
ALTER TABLE `sales_whatsapp_group_name` ADD COLUMN `enquiry_id` VARCHAR(100) NULL;
CREATE INDEX `sales_whatsapp_group_name_enquiry_id_idx` ON `sales_whatsapp_group_name`(`enquiry_id`);
