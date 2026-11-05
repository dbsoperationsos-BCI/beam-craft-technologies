-- One favicon, not one per tab theme.
--
-- The pair existed because a bare dark mark disappears on a dark tab strip and a light one on a
-- light strip. In practice a studio uploads a mark that already carries its own background - the
-- Beam Craft icon is a white rounded square - and that one file reads correctly on both, so being
-- asked for two was asking the same question twice.
--
-- The value is carried over rather than dropped: whichever of the two was set becomes the single
-- favicon, the light one winning where both were. Nothing is lost for a studio that had uploaded
-- either. The bundled pair in /brand still stands behind an empty field, which is the one place a
-- per-theme mark still earns its keep: it is the shipped wordmark, which has no background of its
-- own.
ALTER TABLE `image_selection_settings`
  ADD COLUMN `favicon_url` VARCHAR(500) NULL;

UPDATE `image_selection_settings`
   SET `favicon_url` = COALESCE(`favicon_light_url`, `favicon_dark_url`)
 WHERE `favicon_light_url` IS NOT NULL OR `favicon_dark_url` IS NOT NULL;

ALTER TABLE `image_selection_settings`
  DROP COLUMN `favicon_light_url`,
  DROP COLUMN `favicon_dark_url`;
