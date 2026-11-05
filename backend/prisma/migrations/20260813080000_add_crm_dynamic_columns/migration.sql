-- The custom fields built in Settings › Table Settings, one row per field per vertical.
--
-- `SalesCrmDynamicColumn` is declared in `schema.prisma` and altered by
-- `20260813090000_add_crm_table_settings_custom_fields`, but no migration ever created it - it
-- reached the development database outside the migration chain. A fresh database therefore stopped
-- at that ALTER with error 1146, table doesn't exist, which is the first thing `migrate deploy`
-- hits on a clean install. Created here, immediately before the migration that alters it.
--
-- The four columns that ALTER adds (`fieldType`, `placeholder`, `required`, `options`) are
-- deliberately absent: this is the table as it stood before it, so the chain still reaches the
-- same final shape whichever end it starts from.
--
-- `IF NOT EXISTS`, because every database that has already run past this point has the table.
CREATE TABLE IF NOT EXISTS `SalesCrmDynamicColumn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branch` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SalesCrmDynamicColumn_branch_key_key`(`branch`, `key`),
    INDEX `SalesCrmDynamicColumn_branch_sortOrder_idx`(`branch`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
