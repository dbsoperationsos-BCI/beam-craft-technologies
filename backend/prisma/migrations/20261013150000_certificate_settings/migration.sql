-- Settings → Employee → Certificate → Experience and Employment: each certificate's e-signature,
-- closing note, and the authorised signatory's name and designation. All optional.
ALTER TABLE `hrm_settings`
  ADD COLUMN `experience_certificate_signature_url` TEXT NULL,
  ADD COLUMN `experience_certificate_note` TEXT NULL,
  ADD COLUMN `experience_certificate_signatory_name` VARCHAR(191) NULL,
  ADD COLUMN `experience_certificate_signatory_designation` VARCHAR(191) NULL,
  ADD COLUMN `employment_certificate_signature_url` TEXT NULL,
  ADD COLUMN `employment_certificate_note` TEXT NULL,
  ADD COLUMN `employment_certificate_signatory_name` VARCHAR(191) NULL,
  ADD COLUMN `employment_certificate_signatory_designation` VARCHAR(191) NULL;
