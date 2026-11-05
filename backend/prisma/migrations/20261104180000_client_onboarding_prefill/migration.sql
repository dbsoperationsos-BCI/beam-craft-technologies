-- The company details the team may fill in on the invite, shown pre-filled on the client form.
ALTER TABLE `client_onboarding_invite` ADD COLUMN `prefill` JSON NULL;
