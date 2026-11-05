-- The code a referral is read by on HRM → Employee Referral: `DBS-REF-000001`.
--
-- Every other register in the studio hands its records a code somebody can quote — an asset, a
-- vendor, a call — and the referral register had only the row's own database id, which is exactly
-- what may never appear on screen. One run of numbers for the whole studio: a referral is one
-- employee introducing another and neither belongs to a vertical or a branch.
--
-- Nullable because the rows are already here. `scripts/renumberIdentifiers.js --apply` fills them
-- in, oldest referral first, and leaves the counter where the live path carries on from; a row that
-- somehow still has none is given the next code the next time it is saved. Unique either way, so
-- two referrals can never be quoted under one code — MySQL allows many NULLs in a unique index,
-- which is what lets the column be added before it is filled.
ALTER TABLE `employee_referral`
  ADD COLUMN `referral_id` VARCHAR(30) NULL,
  ADD UNIQUE INDEX `employee_referral_referral_id_key` (`referral_id`);
