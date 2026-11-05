-- Meta's delivery webhook reports what became of a guest photo-match message (AI Feature and Photo
-- Selling): when it was delivered and read. Additive only: two nullable columns on each table and an
-- index for finding a Photo Selling message by Meta's id (the AI Feature's table has one already).
-- No existing row is read or changed.

-- AlterTable
ALTER TABLE `ai_event_notification`
    ADD COLUMN `delivered_at` DATETIME(3) NULL,
    ADD COLUMN `read_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `photo_sale_notification`
    ADD COLUMN `delivered_at` DATETIME(3) NULL,
    ADD COLUMN `read_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `photo_sale_notification_provider_message_id_idx` ON `photo_sale_notification`(`provider_message_id`);
