-- A Photo Selling gallery that has orders can now be deleted: its photos, files and guests go, and the
-- gallery row stays, marked deleted, so its orders and payments keep their gallery
-- (galleries/service.js removeGallery). A new nullable column: every existing gallery reads as not deleted.

-- AlterTable
ALTER TABLE `photo_sale_gallery` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `photo_sale_gallery_deleted_at_idx` ON `photo_sale_gallery`(`deleted_at`);
