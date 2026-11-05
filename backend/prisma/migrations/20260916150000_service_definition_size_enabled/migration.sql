-- A service says whether it is sold by size.
--
-- Settings → Project → Services → Add / Edit Service asks Size: Yes or No. Yes puts a Size on every
-- pricing line - typed, with the studio's service size lists suggested - so the same shoot type and
-- timing is priced once per size, and a quotation line takes the row matching the size picked on
-- it. NULL on every row already here reads as No: nothing already priced changes.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_service_definition` ADD COLUMN `size_enabled` BOOLEAN NULL;
