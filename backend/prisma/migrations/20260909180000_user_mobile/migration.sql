-- The number a password-reset code goes to, for a login with no employee record.
--
-- Recovery is by OTP against the number on somebody's employee record - `employee.contact_number`,
-- the one they gave during onboarding. That covers everybody who works here, and not the accounts
-- that are not people: the studio's Super Admin has no employee record at all, so it had nowhere to
-- receive a code and would have been permanently unable to reset its own password.
--
-- Nullable, and it stays empty for every login that has an employee: the employee's number wins in
-- `accountForMobile`, so this is a place to put a number rather than a second copy of one.
ALTER TABLE `user` ADD COLUMN `mobile` VARCHAR(30) NULL;
