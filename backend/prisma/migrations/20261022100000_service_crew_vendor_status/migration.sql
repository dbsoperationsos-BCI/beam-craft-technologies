-- Where a vendor on a service stands: WAITING until they confirm the shoot, CONFIRMED once they have.
-- A service's person who is an employee is asked for a camera instead and leaves this null, as does
-- every row written before this column existed - nothing is backfilled.
ALTER TABLE `project_production_service_crew` ADD COLUMN `vendor_status` VARCHAR(20) NULL;
