-- Photo Selling sells each photo's untouched original, kept in a private R2 bucket, instead of a
-- web-size copy (with originals delivered by hand from the studio's drive).
--
-- - `photo_sale_photo.original_key`: where the original sits in the private originals bucket. Null
--   for a photo uploaded before this change: it has no original stored and cannot be bought until
--   it is uploaded again.
-- - One price per photo: `digital_price_paise` becomes `price_paise` on the gallery and on the photo.
--   A gallery that already priced originals keeps that price, since an original is what is now sold;
--   `original_price_paise` is then dropped.
-- - Order items default to ORIGINAL. Items already made keep their kind and delivery columns.
-- - `photo_sale_download.ticket_hash`: unique, so one download ticket serves one download.
--
-- Photo Selling's own tables only; no other module's table is touched and no row is deleted.

-- AlterTable
ALTER TABLE `photo_sale_photo` ADD COLUMN `original_key` VARCHAR(1024) NULL;
ALTER TABLE `photo_sale_photo` RENAME COLUMN `digital_price_paise` TO `price_paise`;

-- AlterTable
UPDATE `photo_sale_gallery` SET `digital_price_paise` = `original_price_paise` WHERE `original_price_paise` IS NOT NULL;
ALTER TABLE `photo_sale_gallery` RENAME COLUMN `digital_price_paise` TO `price_paise`;
ALTER TABLE `photo_sale_gallery` DROP COLUMN `original_price_paise`;

-- AlterTable
ALTER TABLE `photo_sale_order_item` MODIFY `kind` VARCHAR(10) NOT NULL DEFAULT 'ORIGINAL';

-- AlterTable
ALTER TABLE `photo_sale_download` ADD COLUMN `ticket_hash` CHAR(64) NULL;
CREATE UNIQUE INDEX `photo_sale_download_ticket_hash_key` ON `photo_sale_download`(`ticket_hash`);
