-- A company-issued phone number, where the studio has given this person one - distinct from
-- `contact_number`, which is theirs. Optional, on the same footing as every other phone column on
-- this table: most employees are never issued one, and nothing here requires it.
ALTER TABLE `employee`
  ADD COLUMN `company_given_number` VARCHAR(30) NULL;
