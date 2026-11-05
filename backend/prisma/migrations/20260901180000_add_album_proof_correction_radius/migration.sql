-- A drawn correction area is stored as a radius normalized to the rendered proof width.
-- NULL preserves legacy point-only pins.
ALTER TABLE `album_proof_correction`
  ADD COLUMN `radius_normalized` DOUBLE NULL;
