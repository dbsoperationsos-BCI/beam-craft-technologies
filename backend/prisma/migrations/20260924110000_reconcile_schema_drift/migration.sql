-- Reconciles the database with schema.prisma where the two had drifted apart.
--
-- `prisma migrate diff` against a database built from these migrations reported forty-odd lines
-- that no code change had asked for. Most were names: hand-written migrations named their indexes
-- and foreign keys differently from Prisma's convention, and nine `updated_at` columns carry a
-- database default the schema did not mention. Those are now *declared* in schema.prisma (`map:`
-- and `@default(now())`) rather than renamed here, because a name is not worth a table rebuild.
--
-- What is left is real, and this is it:
--
-- 1. `image_selection_deliverable_config.image_selection_folder_id`, added by 20260821090000 and
--    later removed from the schema without a migration. Nothing reads it; the folder purge had to
--    clear it defensively before it could delete a folder (see folders/repository.js, which no
--    longer needs to). Its RESTRICT foreign key and two indexes go with it.
-- The diff also asked to drop the same table's project foreign key (without adding it back) and to
-- add `asset_request_sub_category_id_fkey`, which already exists. Both were artefacts of the unique
-- index below: the project key leant on it, and Prisma's plan to drop the index confused its view of
-- the neighbouring keys. With the index gone, both requests go with it and the diff is clean.

-- ── The leftover folder link ──
ALTER TABLE `image_selection_deliverable_config` DROP FOREIGN KEY `image_selection_deliverable_config_image_selection_folder__fkey`;
DROP INDEX `image_selection_config_folder_unique` ON `image_selection_deliverable_config`;
DROP INDEX `image_selection_deliverable_config_image_selection_folder_i_idx` ON `image_selection_deliverable_config`;
ALTER TABLE `image_selection_deliverable_config` DROP COLUMN `image_selection_folder_id`;
