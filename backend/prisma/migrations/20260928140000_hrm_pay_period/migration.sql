-- Settings → Employee → Attendance calculator: the studio's pay period and the day its salary is paid
-- out ("payback date"), kept on the studio-wide HR settings row beside the referral amount.
--
-- Three nullable dates, so nothing is assumed until somebody sets them: the page offers the 25th of
-- one month to the 25th of the next until a period is saved, and "not set" for the payback date.
--
-- Cost: three columns on a one-row table. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `pay_period_start` DATE NULL,
  ADD COLUMN `pay_period_end` DATE NULL,
  ADD COLUMN `payback_date` DATE NULL;
