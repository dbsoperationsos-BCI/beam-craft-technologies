-- The employee's own photograph, collected on the onboarding link alongside the Aadhaar and PAN
-- proofs and stored exactly as they are: normally a link into R2, but MEDIUMTEXT so the compressed
-- data URI that stands in when object storage is unconfigured still fits.
ALTER TABLE `employee` ADD COLUMN `profile_photo_url` MEDIUMTEXT NULL;
