-- The invite is created from company details alone: no product or contact person is required on it.
ALTER TABLE `client_onboarding_invite` MODIFY `product` VARCHAR(40) NULL, MODIFY `contact_name` VARCHAR(150) NULL, MODIFY `contact_email` VARCHAR(191) NULL, MODIFY `contact_phone` VARCHAR(30) NULL;
ALTER TABLE `subscription_client` MODIFY `product` VARCHAR(40) NULL, MODIFY `contact_email` VARCHAR(191) NULL;
