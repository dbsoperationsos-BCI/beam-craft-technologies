-- Pre Production → Location for a shoot held at several places (Add / Edit Shoot → Location:
-- Multiple). One { shoot, locationAddress, locationLink } per name of the shoot is kept here;
-- location_address and location_link hold them labelled, one per line. NULL - every existing row -
-- is one place, read exactly as before.
--
-- Cost: one nullable column, no backfill. Instant on MySQL 8 (ALGORITHM=INSTANT).

ALTER TABLE `project_pre_production` ADD COLUMN `locations` JSON NULL;
