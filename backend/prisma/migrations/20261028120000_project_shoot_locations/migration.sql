-- Add / Edit Shoot → Location: Multiple. A shoot made of several ("Haldi + Mehandi") held at
-- different places keeps one { shoot, shootPlace, district, state } per name here; shoot_place,
-- district and state hold the places joined from them. NULL - every existing row - is one place,
-- read exactly as before.
--
-- Cost: one nullable column, no backfill. Instant on MySQL 8 (ALGORITHM=INSTANT).

ALTER TABLE `project_shoot` ADD COLUMN `shoot_locations` JSON NULL;
