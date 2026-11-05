-- Signature Album: which Global Logo the album's pages draw.
--
-- One column. Settings holds a light-mode and a dark-mode Global Logo, and until now the album
-- always drew the light-mode one - dark lettering that vanished on the Cinematic and Luxury themes'
-- black ground. The album's pages now pick between the two by the album's own background, and
-- this column lets a studio pin the choice: AUTO (the default, and what every existing album
-- reads as), DARK (the mark for a dark ground) or LIGHT (the mark for a light ground).
--
-- Cost: one NOT NULL column with a default on one table, no backfill. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

ALTER TABLE `signature_album`
  ADD COLUMN `logo_variant` VARCHAR(8) NOT NULL DEFAULT 'AUTO';
