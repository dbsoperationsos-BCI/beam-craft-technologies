-- The quotation Categories become one list per brand.
--
-- `lead_religion` was one list for the studio, read by the Dum Dum quotation alone. Every brand's
-- quotation asks for a Category now, and Dum Dum's categories are not Qua Qua's, so each row is
-- filed under a brand: `vertical` holds the brand code (DUM_DUM, QUA_QUA, CORP), Field Settings
-- draws a tab per brand, and the form reads its own brand's rows.
--
-- Every row already here was written under the Dum Dum tab - it was the only quotation that asked -
-- so the column arrives with that default, the rows take it, and the default is then dropped so a
-- row can never be filed under a brand nobody chose. The code is unique per brand from here on,
-- which is what lets two brands each hold a "General".
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `lead_religion` ADD COLUMN `vertical` VARCHAR(50) NOT NULL DEFAULT 'DUM_DUM' AFTER `id`;
ALTER TABLE `lead_religion` ALTER COLUMN `vertical` DROP DEFAULT;
ALTER TABLE `lead_religion` DROP INDEX `lead_religion_code_key`;
ALTER TABLE `lead_religion` ADD UNIQUE INDEX `lead_religion_vertical_code_key`(`vertical`, `code`);
ALTER TABLE `lead_religion` DROP INDEX `lead_religion_is_active_name_idx`;
CREATE INDEX `lead_religion_vertical_is_active_name_idx` ON `lead_religion`(`vertical`, `is_active`, `name`);
