-- How the crew travels to a shoot: Bus, Train, Flight, Own, Office Vehicle, or Other.
--
-- "Other" is spelled out in `travel_mode_other`. "Office Vehicle" points at the actual vehicle in
-- Asset Management — the FK — with the vehicle's name denormalised beside it the same way the
-- coordinator columns keep a name beside an employee id, so the record still reads if the asset is
-- later sold or retired (the FK then goes null, the name stays).
ALTER TABLE `project_pre_production`
  ADD COLUMN `travel_mode` VARCHAR(30) NULL,
  ADD COLUMN `travel_mode_other` VARCHAR(191) NULL,
  ADD COLUMN `travel_vehicle_asset_id` INTEGER NULL,
  ADD COLUMN `travel_vehicle_name` VARCHAR(191) NULL;

ALTER TABLE `project_pre_production` ADD CONSTRAINT `project_pre_production_travel_vehicle_asset_id_fkey`
  FOREIGN KEY (`travel_vehicle_asset_id`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
