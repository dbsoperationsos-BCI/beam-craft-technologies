-- Sale Extras: a correction names the published line it corrects.
--
-- A published extra is final - the client has seen it - so a mistyped amount is put right by a new
-- CORRECTION line in the next revision, which records which line it corrects here. Additive: one
-- nullable column, its key and index; no row written.

ALTER TABLE `project_sale_extra` ADD COLUMN `corrects_extra_id` VARCHAR(191) NULL;
CREATE INDEX `project_sale_extra_corrects_extra_id_idx` ON `project_sale_extra`(`corrects_extra_id`);
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_corrects_extra_id_fkey` FOREIGN KEY (`corrects_extra_id`) REFERENCES `project_sale_extra`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
