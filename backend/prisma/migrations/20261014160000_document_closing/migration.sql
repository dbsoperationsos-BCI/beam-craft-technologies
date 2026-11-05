-- Settings -> Employee -> Certificate -> Experience, Employment and Offer Letter: the line each closes
-- with, above the signature. NULL until typed, and printed as "Sincerely," while it is - so every
-- document reads as it did.

ALTER TABLE `hrm_settings` ADD COLUMN `experience_certificate_closing` VARCHAR(100) NULL,
    ADD COLUMN `employment_certificate_closing` VARCHAR(100) NULL,
    ADD COLUMN `offer_letter_closing` VARCHAR(100) NULL;
