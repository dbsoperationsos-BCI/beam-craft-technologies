-- What the studio charges, held against the thing being charged for.
--
-- A service and a deliverable each carry one price; a size carries a price per unit, because a 12x6
-- album is not priced like a 36x18 one and the difference belongs to the size rather than to the
-- deliverable that offers it.
--
-- All nullable: a service nobody has priced yet is a real state, and zero would claim it is free.
ALTER TABLE `project_service_definition` ADD COLUMN `price` DECIMAL(12, 2) NULL;
ALTER TABLE `project_deliverable_definition` ADD COLUMN `price` DECIMAL(12, 2) NULL;
ALTER TABLE `project_option_set_value` ADD COLUMN `price_per_quantity` DECIMAL(12, 2) NULL;
