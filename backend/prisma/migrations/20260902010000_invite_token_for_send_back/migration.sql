-- The raw onboarding token, kept so Send Back can email the candidate the same link again.
-- A deliberate softening of the hash-only design: the token opens one public form, not an
-- account, and resending the identical link is what HR needs. Null on invites created earlier,
-- which therefore cannot be sent back and say so.
ALTER TABLE `employee_onboarding_invite` ADD COLUMN `token` VARCHAR(64) NULL;
