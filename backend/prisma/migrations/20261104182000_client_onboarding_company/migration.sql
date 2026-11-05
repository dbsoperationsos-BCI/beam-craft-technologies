-- The company details the team enters on the invite; the client confirms them from the link.
ALTER TABLE `client_onboarding_invite` ADD COLUMN `company` JSON NULL;
