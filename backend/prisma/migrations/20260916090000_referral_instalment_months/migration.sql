-- How many months a referral is settled over becomes the studio's to set.
--
-- The schedule was `PAYOUT_MONTHS = [3, 6]`, a constant in `modules/hrm/referrals/service.js`, so a
-- studio that wanted to pay in thirds across a year had to have the application changed. It is a
-- setting now, and it sits beside the total it divides in the one `hrm_settings` row.
--
-- Stored as the month offsets themselves rather than a count. `employee_referral_payout.month_offset`
-- is what an instalment is - the register reads "3rd month" off it, and the unique index on
-- (referral_id, month_offset) is what stops a schedule being generated twice - so the setting speaks
-- in the same units the rows do. A count would have to invent the spacing, and 3-and-6 is not evenly
-- spaced from zero.
--
-- Defaulted to '3,6' so every studio carries on paying exactly as it did until somebody changes it,
-- and NOT NULL so the read path never has to answer "no schedule at all".
ALTER TABLE `hrm_settings`
  ADD COLUMN `referral_instalment_months` VARCHAR(100) NOT NULL DEFAULT '3,6';
