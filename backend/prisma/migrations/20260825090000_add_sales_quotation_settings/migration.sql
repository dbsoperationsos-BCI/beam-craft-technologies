-- The rates the Quotation Generator prices with. One row, keyed "default", the same shape as
-- `image_selection_settings`: these belong to the studio rather than to a user.
CREATE TABLE `sales_quotation_settings` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `service_rate` DECIMAL(12, 2) NOT NULL DEFAULT 2000,
    `deliverable_rate` DECIMAL(12, 2) NOT NULL DEFAULT 1000,
    `default_discount_percent` DECIMAL(5, 2) NOT NULL DEFAULT 20,
    `gst_percent` DECIMAL(5, 2) NOT NULL DEFAULT 18,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the single row so the first read has the studio's current numbers rather than nothing.
INSERT INTO `sales_quotation_settings` (`id`, `updated_at`) VALUES ('default', CURRENT_TIMESTAMP(3));
