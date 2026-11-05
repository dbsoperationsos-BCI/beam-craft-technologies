-- Signature Album: a chapter's cover can be positioned, the way the album's cover already can.
--
-- Four nullable columns on `signature_album_chapter` and nothing else - the same four the album's
-- cover was given in 20260924120000: FIT / FILL, the focal point as 0-100 percentages, a zoom of
-- 1 to 2. Presentation metadata only: the `image_selection_upload` row, its R2 previews and the
-- original are never written. Nullable and read as "what the band always drew" (FILL, centred,
-- 1x), so no existing chapter needs rewriting and every existing cover draws as before.
--
-- Cost: four nullable columns on one table, no backfill. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

ALTER TABLE `signature_album_chapter`
  ADD COLUMN `cover_display_mode` VARCHAR(8) NULL,
  ADD COLUMN `cover_focal_x` INTEGER NULL,
  ADD COLUMN `cover_focal_y` INTEGER NULL,
  ADD COLUMN `cover_zoom` DOUBLE NULL;
