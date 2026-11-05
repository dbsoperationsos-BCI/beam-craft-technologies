-- A login's own photograph, for accounts with no employee record to keep one on (the standalone
-- Super Admin). Stored exactly as the employee's is: normally a link into R2, but MEDIUMTEXT so
-- the compressed data URI that stands in when object storage is unconfigured still fits.
ALTER TABLE `user` ADD COLUMN `profile_photo_url` MEDIUMTEXT NULL;
