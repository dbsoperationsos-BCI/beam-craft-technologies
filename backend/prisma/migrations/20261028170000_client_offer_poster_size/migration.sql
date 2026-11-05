-- An offer's poster keeps its size: square 1080 x 1080, portrait 1080 x 1350 or story 1080 x 1920,
-- so the clients' app draws each one whole at its own shape before the picture has loaded.
--
-- Two new columns, empty on the rows already there (the app reads those as the earlier wide poster),
-- so there is nothing to fail on production data.

ALTER TABLE `client_offer`
  ADD COLUMN `image_width` INTEGER NULL,
  ADD COLUMN `image_height` INTEGER NULL;
