-- Where the project's hard disk has got to, as pre production tracks it on General: NOT_RECEIVED,
-- RECEIVED, HANDED_OVER. NULL on every row written before this and read as NOT_RECEIVED, so no
-- backfill is needed. Handing the disk over is what starts its Client Storage record.
ALTER TABLE `sales_project` ADD COLUMN `hard_disk_status` VARCHAR(20) NULL;
