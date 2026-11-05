-- Signature Album: non-destructive photo positioning.
--
-- Eight nullable columns and nothing else. A photo in a designed frame (an Editorial pair, a Grid
-- square, the cover) was always cropped dead centre with no way to move it. The album item and
-- the album's cover now carry how the photo sits in its frame - FIT (the whole photograph) or FILL
-- (fill the frame, crop around a focal point), the focal point as 0-100 percentages, and a zoom of
-- 1 to 2. Presentation metadata only: the `image_selection_upload` row, its R2 previews and the
-- original on the studio's storage are never written, and the same source photo used anywhere
-- else is untouched. The columns are nullable and read as "the default the frame always had"
-- (FILL, centred, 1x), so no existing album or item needs rewriting.
--
-- Cost: eight nullable columns on two tables, no backfill. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

ALTER TABLE `signature_album`
  ADD COLUMN `cover_display_mode` VARCHAR(8) NULL,
  ADD COLUMN `cover_focal_x` INTEGER NULL,
  ADD COLUMN `cover_focal_y` INTEGER NULL,
  ADD COLUMN `cover_zoom` DOUBLE NULL;

ALTER TABLE `signature_album_item`
  ADD COLUMN `display_mode` VARCHAR(8) NULL,
  ADD COLUMN `focal_x` INTEGER NULL,
  ADD COLUMN `focal_y` INTEGER NULL,
  ADD COLUMN `zoom` DOUBLE NULL;
