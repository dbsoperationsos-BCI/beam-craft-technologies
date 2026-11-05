-- Multi-brand quotations: one quotation engine, three brands.
--
-- A quotation has always been raised for one of the studio's three verticals - Dum Dum, Qua Qua,
-- Corp - and that choice lived only inside the version's JSON payload (`payload.vertical`). This
-- migration lifts it into a column, `sales_quotation.quotation_brand`, so the register can filter
-- and badge on it, and adds the master tables a brand's configuration is kept in: its services,
-- deliverables, packages and terms, plus the brand row itself with its logo, event types and the
-- client-facing wording it changes on the PDF.
--
-- Nothing is dropped and nothing is rewritten. Every existing version keeps its payload, its
-- number, its link and its logo; it gains one column, backfilled from what its own payload already
-- says. A version whose payload names no vertical reads DUM_DUM, which is what the rest of the
-- application already reads an unnamed vertical as.
--
-- The master tables start almost empty on purpose. A brand with no services or deliverables of
-- its own offers the whole project catalogue priced by `sales_quotation_settings`, a brand with no
-- terms prints the studio's standard clauses, and a brand with no PDF overrides prints the page
-- exactly as it prints today - so the generator behaves as it did the moment this runs, and the
-- studio configures each brand from Settings -> Quotation Settings at its own pace.

-- 1. The brand column, backfilled from the payload.
ALTER TABLE `sales_quotation`
  ADD COLUMN `quotation_brand` VARCHAR(20) NOT NULL DEFAULT 'DUM_DUM';

-- The payload's own answer first, then the chain number, which carries the vertical code the
-- counter minted it under (`DBS-QO-QQ-ERD-000001`). Either is enough on its own; both are read so
-- a payload saved by an older client without a vertical is still filed under the brand its number
-- says. Anything else is Dum Dum, as it was read before this column existed.
UPDATE `sales_quotation`
SET `quotation_brand` = CASE
  WHEN LOWER(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.vertical')), ''), ' ', '')) IN ('quaqua', 'qq') THEN 'QUA_QUA'
  WHEN LOWER(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.vertical')), ''), ' ', '')) IN ('corp', 'corporate') THEN 'CORP'
  WHEN LOWER(REPLACE(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.vertical')), ''), ' ', '')) IN ('dumdum', 'dd', 'wed', 'wedding') THEN 'DUM_DUM'
  WHEN `quotation_number` LIKE 'DBS-QO-QQ-%' THEN 'QUA_QUA'
  WHEN `quotation_number` LIKE 'DBS-QO-CORP-%' THEN 'CORP'
  ELSE 'DUM_DUM'
END;

CREATE INDEX `sales_quotation_quotation_brand_idx` ON `sales_quotation`(`quotation_brand`);

-- 2. The brand itself.
CREATE TABLE `sales_quotation_brand` (
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `vertical_name` VARCHAR(50) NOT NULL,
    `logo_url` VARCHAR(500) NULL,
    `event_types` JSON NULL,
    `pdf_content` JSON NULL,
    `gst_percent` DECIMAL(5, 2) NULL,
    `default_discount_percent` DECIMAL(5, 2) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_quotation_brand_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. What each brand quotes with.
CREATE TABLE `sales_quotation_brand_service` (
    `id` VARCHAR(191) NOT NULL,
    `brand_code` VARCHAR(20) NOT NULL,
    `service_definition_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `default_price` DECIMAL(12, 2) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sqb_service_brand_active_sort_idx`(`brand_code`, `is_active`, `sort_order`),
    INDEX `sqb_service_definition_idx`(`service_definition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_quotation_brand_deliverable` (
    `id` VARCHAR(191) NOT NULL,
    `brand_code` VARCHAR(20) NOT NULL,
    `deliverable_definition_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `default_price` DECIMAL(12, 2) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sqb_deliverable_brand_active_sort_idx`(`brand_code`, `is_active`, `sort_order`),
    INDEX `sqb_deliverable_definition_idx`(`deliverable_definition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_quotation_brand_package` (
    `id` VARCHAR(191) NOT NULL,
    `brand_code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sqb_package_brand_active_sort_idx`(`brand_code`, `is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_quotation_brand_package_item` (
    `id` VARCHAR(191) NOT NULL,
    `package_id` VARCHAR(191) NOT NULL,
    `item_type` VARCHAR(20) NOT NULL,
    `master_id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `default_price` DECIMAL(12, 2) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sqb_package_item_package_sort_idx`(`package_id`, `sort_order`),
    INDEX `sqb_package_item_master_idx`(`master_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_quotation_brand_term` (
    `id` VARCHAR(191) NOT NULL,
    `brand_code` VARCHAR(20) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sqb_term_brand_active_sort_idx`(`brand_code`, `is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales_quotation_brand_service`
  ADD CONSTRAINT `sales_quotation_brand_service_brand_code_fkey`
  FOREIGN KEY (`brand_code`) REFERENCES `sales_quotation_brand`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_quotation_brand_deliverable`
  ADD CONSTRAINT `sales_quotation_brand_deliverable_brand_code_fkey`
  FOREIGN KEY (`brand_code`) REFERENCES `sales_quotation_brand`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_quotation_brand_package`
  ADD CONSTRAINT `sales_quotation_brand_package_brand_code_fkey`
  FOREIGN KEY (`brand_code`) REFERENCES `sales_quotation_brand`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_quotation_brand_package_item`
  ADD CONSTRAINT `sales_quotation_brand_package_item_package_id_fkey`
  FOREIGN KEY (`package_id`) REFERENCES `sales_quotation_brand_package`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `sales_quotation_brand_term`
  ADD CONSTRAINT `sales_quotation_brand_term_brand_code_fkey`
  FOREIGN KEY (`brand_code`) REFERENCES `sales_quotation_brand`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. The three brands, so the generator's selector has something to offer the moment this runs.
--
-- Dum Dum and Qua Qua carry no overrides at all: Dum Dum is the default the whole module was
-- written for, and its quotations must keep printing exactly as they do. Corp gets the project
-- wording on its event section; it is editable from Settings and not read by code.
INSERT INTO `sales_quotation_brand` (`code`, `name`, `vertical_name`, `event_types`, `pdf_content`, `sort_order`, `updated_at`)
SELECT 'DUM_DUM', 'Dum Dum', 'Dum Dum', NULL, NULL, 0, NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sales_quotation_brand` WHERE `code` = 'DUM_DUM');

INSERT INTO `sales_quotation_brand` (`code`, `name`, `vertical_name`, `event_types`, `pdf_content`, `sort_order`, `updated_at`)
SELECT 'QUA_QUA', 'Qua Qua', 'Qua Qua',
       NULL,
       NULL, 1, NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sales_quotation_brand` WHERE `code` = 'QUA_QUA');

INSERT INTO `sales_quotation_brand` (`code`, `name`, `vertical_name`, `event_types`, `pdf_content`, `sort_order`, `updated_at`)
SELECT 'CORP', 'Corp', 'Corp',
       NULL,
       JSON_OBJECT('eventSectionLabel', 'Production scope', 'eventSectionTitle', 'Project Itinerary'),
       2, NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `sales_quotation_brand` WHERE `code` = 'CORP');
