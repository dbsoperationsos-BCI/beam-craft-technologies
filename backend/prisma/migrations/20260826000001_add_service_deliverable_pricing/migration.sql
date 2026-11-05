-- AddColumn for service_pricing and deliverable_pricing to sales_quotation_settings
ALTER TABLE `sales_quotation_settings` ADD COLUMN `service_pricing` JSON NULL;
ALTER TABLE `sales_quotation_settings` ADD COLUMN `deliverable_pricing` JSON NULL;
