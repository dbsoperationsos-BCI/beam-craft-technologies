-- Client Onboarding (Subscribe): invites sent to companies, and the companies onboarded.

-- CreateTable
CREATE TABLE `client_onboarding_invite` (
    `id` VARCHAR(191) NOT NULL,
    `product` VARCHAR(40) NOT NULL,
    `contact_name` VARCHAR(150) NOT NULL,
    `contact_email` VARCHAR(191) NOT NULL,
    `contact_phone` VARCHAR(30) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token` VARCHAR(64) NULL,
    `short_code` VARCHAR(8) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Created',
    `expires_at` DATETIME(3) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `client_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_onboarding_invite_token_hash_key`(`token_hash`),
    UNIQUE INDEX `client_onboarding_invite_short_code_key`(`short_code`),
    INDEX `client_onboarding_invite_product_status_idx`(`product`, `status`),
    INDEX `client_onboarding_invite_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_client` (
    `id` VARCHAR(191) NOT NULL,
    `product` VARCHAR(40) NOT NULL,
    `company_name` VARCHAR(150) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `gst_number` VARCHAR(15) NOT NULL,
    `pan_number` VARCHAR(10) NOT NULL,
    `logo_url` VARCHAR(500) NOT NULL,
    `favicon_url` VARCHAR(500) NOT NULL,
    `users_needed` INTEGER NOT NULL,
    `main_contact_name` VARCHAR(150) NOT NULL,
    `main_contact_phone` VARCHAR(30) NOT NULL,
    `main_contact_designation` VARCHAR(150) NOT NULL,
    `secondary_contact_name` VARCHAR(150) NOT NULL,
    `secondary_contact_phone` VARCHAR(30) NOT NULL,
    `secondary_contact_designation` VARCHAR(150) NOT NULL,
    `contact_email` VARCHAR(191) NOT NULL,
    `invite_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_client_invite_id_key`(`invite_id`),
    INDEX `subscription_client_product_idx`(`product`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subscription_client` ADD CONSTRAINT `subscription_client_invite_id_fkey` FOREIGN KEY (`invite_id`) REFERENCES `client_onboarding_invite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
