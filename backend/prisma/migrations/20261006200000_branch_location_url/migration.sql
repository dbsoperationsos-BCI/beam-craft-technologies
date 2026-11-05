-- Settings → Organization → Branches → Edit → External URLs: the branch's Location URL - where it is
-- on a map, as its Google Maps link - beside its Web URL and Google Review Link.
--
-- One optional text column, null until the studio fills it in; the branches validation adds
-- https:// to a link typed without a scheme. No permission: the branch form and its endpoints are
-- already behind SETTINGS / Organization.
--
-- Cost: one nullable column on a table of a handful of rows. Instant.
ALTER TABLE `branch` ADD COLUMN `location_url` VARCHAR(500) NULL;
