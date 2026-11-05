-- The invite no longer carries company details from the team; the client fills them all.
ALTER TABLE `client_onboarding_invite` DROP COLUMN `prefill`;
