-- The public identifier in the short client gallery URL (gallery.dontblinkstudioz.com/<code>).
--
-- Nullable on purpose: rows published before this column existed get their code lazily the next
-- time the studio or a publish touches them (plus a one-off backfill script), so no data is
-- rewritten here and nothing existing is at risk. The code is random — never derived from the
-- project id — and unique, so one code resolves to exactly one gallery. It is only a public name
-- for the gallery, not a credential: PIN, publish status and expiry keep gating access.
ALTER TABLE `image_selection_gallery_publication` ADD COLUMN `short_code` VARCHAR(8) NULL;
CREATE UNIQUE INDEX `image_selection_gallery_publication_short_code_key` ON `image_selection_gallery_publication`(`short_code`);
