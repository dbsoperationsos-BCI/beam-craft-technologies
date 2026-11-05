-- The short public code behind the shortened onboarding link (/onboarding/apply/<code>),
-- the same shape the gallery's short_code uses. Nullable: invites created before this keep
-- working through their long tokenized links.
ALTER TABLE `employee_onboarding_invite`
  ADD COLUMN `short_code` VARCHAR(8) NULL,
  ADD UNIQUE INDEX `employee_onboarding_invite_short_code_key` (`short_code`);
