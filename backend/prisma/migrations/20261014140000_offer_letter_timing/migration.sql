-- Settings -> Employee -> Certificate -> Offer Letter -> When to generate: an employee's offer letter
-- is generated this many days after their date of joining (0 is the day itself). NULL until the
-- studio sets it, so no offer letter is generated before then. And the letter's sign-off, as the
-- certificates have theirs: the e-signature, and the signatory's name and designation. And the
-- studio's own sections after Employment Details and Compensation, as `[{ title, content }]`, and
-- which of Employment Details' and Compensation's lines print (with the Statutory Deductions summary).

ALTER TABLE `hrm_settings` ADD COLUMN `offer_letter_after_days` INTEGER NULL,
    ADD COLUMN `offer_letter_signature_url` TEXT NULL,
    ADD COLUMN `offer_letter_sections` JSON NULL,
    ADD COLUMN `offer_letter_compensation` JSON NULL,
    ADD COLUMN `offer_letter_employment` JSON NULL,
    ADD COLUMN `offer_letter_signatory_name` VARCHAR(191) NULL,
    ADD COLUMN `offer_letter_signatory_designation` VARCHAR(191) NULL;
