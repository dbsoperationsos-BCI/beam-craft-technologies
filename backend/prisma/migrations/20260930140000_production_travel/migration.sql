-- Travel moves from pre production's shoot form to the Production Manager's plan, with the detail
-- each mode asks for: "Other" spelled out, Own / Car a vehicle number plate, Office Vehicle the
-- vehicle picked from Asset Management. Additive only; pre production's `travel_*` columns stay
-- (deprecated) until the follow-up migration that drops its production coordinator columns.
ALTER TABLE `project_production`
  ADD COLUMN `travel_mode_other` VARCHAR(191) NULL,
  ADD COLUMN `travel_vehicle_asset_id` INTEGER NULL,
  ADD COLUMN `vehicle_number_plate` VARCHAR(20) NULL;

CREATE INDEX `project_production_travel_vehicle_asset_id_idx` ON `project_production`(`travel_vehicle_asset_id`);

ALTER TABLE `project_production` ADD CONSTRAINT `project_production_travel_vehicle_asset_id_fkey` FOREIGN KEY (`travel_vehicle_asset_id`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
